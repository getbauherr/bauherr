import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { renderToReadableStream } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The agent view: Admin-only fields (cost, client, model, provider, key owner, action buttons) are in an Admin's render and absent from a non-Admin's; unknown and foreign ids say so. */
const session = vi.hoisted(() => ({ cookie: '', ws: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: (k: string) => (k === 'bauherr-ws' && session.ws ? { value: session.ws } : undefined), set: () => {}, delete: () => {} }) }))
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => '/team/ses_view', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true, depth: 0 } as const
const PASSWORD = 'pw-123456-view'
const COST = 4.2718
const PROVIDER = 'provider-secret-x'
const MODEL = 'model-secret-y'
const OWNER = 'owner-secret@x.io'

let payload: Payload
let testDb: TestDb
let cookie: { admin: string; member: string }
let ws: number

beforeAll(async () => {
  testDb = await createTestDb('agent_view')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a' }, ...o })).id as number
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'b', slug: 'b' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace: ws }, ...o })).id as number
  const owner = await payload.create({ collection: 'bauherren', data: { email: OWNER, password: PASSWORD, role: 'bauherr', tenants: [{ tenant: ws }] } as never, ...o })
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: PASSWORD, role: 'admin' }, ...o })
  const member = await payload.create({ collection: 'bauherren', data: { email: 'member@x.io', password: PASSWORD, role: 'bauherr', tenants: [{ tenant: ws }] } as never, ...o })
  cookie = { admin: `bauherr-session=${signSession(admin.id, 0)}`, member: `bauherr-session=${signSession(member.id, 0)}` }
  const now = new Date().toISOString()
  const mk = (publicId: string, workspace: number, extra: Record<string, unknown> = {}) => payload.create({ collection: 'agent_sessions', data: { publicId, role: 'engineer', label: `agent-${publicId}`, clientName: 'client-secret', clientVersion: '9.9', model: MODEL, provider: PROVIDER, connectedAt: now, lastSeenAt: now, workspace, owner: owner.id, ...extra } as never, ...o })
  const s = await mk('ses_view', ws)
  await mk('ses_foreign', other)
  await mk('ses_gone', ws, { disconnectedAt: now, endReason: 'disconnect' })
  const ticket = await payload.create({ collection: 'tickets', data: { title: 'Viewed', externalId: 'v1', number: 7, url: 'https://x/7', state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, workspace: ws, product, stage: 'build', kind: 'build', status: 'running', mode: 'session', session: s.id, startedAt: now } as never, ...o })
  await payload.db.drizzle.execute(sql`INSERT INTO "usage_entries" ("workspace_id", "run_id", "ticket_id", "session_id", "stage", "role", "model", "tokens_in", "tokens_out", "cost_usd", "source", "at") VALUES (${ws}, ${run.id}, ${ticket.id}, ${s.id}, 'build', 'engineer', 'm', 100, 50, ${COST}, 'session-reported', now())`)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const html = async (as: string, id: string, workspace = 'a'): Promise<string> => {
  session.cookie = as
  session.ws = workspace
  const page = (await import('../src/app/(app)/(shell)/team/[id]/page')).default
  const stream = await renderToReadableStream((await page({ params: Promise.resolve({ id }) })) as never)
  await stream.allReady
  return await new Response(stream).text()
}
const text = (s: string) => s.replace(/<!-- -->/g, '')

describe('agent view', () => {
  it('an Admin sees identity with provider, cost, key owner and the Disconnect action', async () => {
    const out = text(await html(cookie.admin, 'ses_view'))
    expect(out).toContain(`client-secret 9.9 · ${MODEL} · ${PROVIDER}`)
    expect(out).toMatch(/data-testid="agent-cost"/)
    expect(out).toContain('$4.27')
    expect(out).toContain(OWNER)
    expect(out).toContain('data-testid="disconnect"')
    expect(out).not.toContain('data-testid="release-lock"')
    for (const part of ['Current Run', 'Milestones', 'Runs', 'Details']) expect(out).toContain(`>${part}<`)
  })

  it('a non-Admin render carries no cost, client, model, provider, key owner or admin action', async () => {
    const out = text(await html(cookie.member, 'ses_view'))
    expect(out).toContain('agent-ses_view')
    expect(out).toContain('Building #7')
    for (const secret of ['4.27', '4.2718', 'client-secret', MODEL, PROVIDER, OWNER, 'data-testid="agent-cost"', 'data-testid="agent-identity"', 'data-testid="disconnect"', 'data-testid="release-lock"', 'Disconnect', 'Release lock']) expect(out).not.toContain(secret)
  })

  it('the non-Admin view data passed to client components holds no cost, usage, identity or key owner', async () => {
    const { loadSession } = await import('../src/lib/sessions')
    const json = JSON.stringify(await loadSession(payload, ws, 'ses_view', { admin: false }))
    expect(json).toContain('agent-ses_view')
    for (const secret of ['costUsd', '4.2718', 'client-secret', MODEL, PROVIDER, OWNER]) expect(json).not.toContain(secret)
  })

  it('a disconnected session says when and why and offers no Disconnect', async () => {
    const out = text(await html(cookie.admin, 'ses_gone'))
    expect(out).toContain('Disconnected: The agent ended the session.')
    expect(out).not.toContain('data-testid="disconnect"')
  })

  it('an unknown id and one of another Workspace show "This agent does not exist."', async () => {
    for (const id of ['ses_nope', 'ses_foreign']) {
      const out = text(await html(cookie.admin, id))
      expect(out).toContain('This agent does not exist.')
      expect(out).not.toContain('client-secret')
    }
  })
})

describe('agent actions', () => {
  const act = async (as: string, name: 'disconnectSession' | 'releaseSessionLock', id: string) => {
    session.cookie = as
    session.ws = 'a'
    return (await import('../src/app/(app)/(shell)/team/actions'))[name](id)
  }
  const row = async (id: string) => (await payload.db.drizzle.execute(sql`SELECT "disconnected_at", "end_reason" FROM "agent_sessions" WHERE "public_id" = ${id}`)).rows[0] as Record<string, unknown>
  const runStatus = async () => ((await payload.db.drizzle.execute(sql`SELECT "status"::text AS "status" FROM "runs" WHERE "workspace_id" = ${ws}`)).rows[0] as { status: string }).status

  it('a non-Admin cannot disconnect or release; nothing changes', async () => {
    expect(await act(cookie.member, 'disconnectSession', 'ses_view')).toMatchObject({ error: expect.any(String) })
    expect(await act(cookie.member, 'releaseSessionLock', 'ses_view')).toMatchObject({ error: expect.any(String) })
    expect((await row('ses_view')).disconnected_at).toBeNull()
    expect(await runStatus()).toBe('running')
  })

  it('an Admin cannot disconnect a session of another Workspace', async () => {
    expect(await act(cookie.admin, 'disconnectSession', 'ses_foreign')).toMatchObject({ error: expect.any(String) })
    expect((await row('ses_foreign')).disconnected_at).toBeNull()
  })

  it('Release lock refuses a session that still answers', async () => {
    expect(await act(cookie.admin, 'releaseSessionLock', 'ses_view')).toEqual({ error: 'The agent is still responding.' })
    expect(await runStatus()).toBe('running')
  })

  it('an Admin releases the lock of a silent session, then disconnects it', async () => {
    await payload.db.drizzle.execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now() - interval '1 hour' WHERE "public_id" = 'ses_view'`)
    expect(await act(cookie.admin, 'releaseSessionLock', 'ses_view')).toBeUndefined()
    expect(await runStatus()).not.toBe('running')
    expect(await act(cookie.admin, 'disconnectSession', 'ses_view')).toBeUndefined()
    expect(await row('ses_view')).toMatchObject({ end_reason: 'disconnect' })
  })
})

