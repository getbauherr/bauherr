import { generateKeyPairSync } from 'node:crypto'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Bauherr } from '../src/app/(app)/lib/session'
import { connectionInput } from '../src/lib/connection'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../src/lib/settings-guards'
import { bauherrOf } from './helpers/person'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const lockState = z.object({ lockUntil: z.string().nullish(), loginAttempts: z.number().optional() })
const tenantsOf = z.object({ tenants: z.array(z.object({ tenant: z.number() })) })

let payload: Payload
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('settings')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('refuses a change that would leave no Admin', async () => {
  const only = await payload.create({
    collection: 'bauherren',
    data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' },
    ...o,
  })
  await expect(assertAnotherAdmin(payload, only.id as number)).rejects.toThrow('Add another Admin first')
  const second = await payload.create({
    collection: 'bauherren',
    data: { email: 'b@x.io', password: 'pw-123456', role: 'admin' },
    ...o,
  })
  await expect(assertAnotherAdmin(payload, only.id as number)).resolves.toBeUndefined()
  await expect(assertAnotherAdmin(payload, second.id as number)).resolves.toBeUndefined()
})

it('rejects a Connection of a foreign Workspace', async () => {
  const [mine, other] = await Promise.all(
    ['mine', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })),
  )
  const c = await payload.create({
    collection: 'connections',
    data: { name: 'gh', kind: 'github', workspace: other.id },
    ...o,
  })
  await expect(assertInWorkspace(payload, 'connections', [c.id as number], mine.id as number)).rejects.toThrow(
    'Not in this Workspace',
  )
  await expect(assertInWorkspace(payload, 'connections', [c.id as number], other.id as number)).resolves.toBeUndefined()
})

it('stores a GitHub App private key encrypted and never returns it', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'App', slug: 'app-key' }, ...o })
  const workspace = ws.id
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  const config = { appId: '12', installationId: '34' }
  const hook = 'whsec-literal-test-value'
  const data = { name: 'app', kind: 'github', config, secret: pem, webhookSecret: hook, workspace } as const
  const c = await payload.create({ collection: 'connections', data, ...o })
  const read = JSON.stringify(await payload.findByID({ collection: 'connections', id: c.id, ...o }))
  expect(read).not.toContain('PRIVATE KEY')
  expect(read).not.toContain(hook)
  const stored = await payload.findByID({ collection: 'connections', id: c.id, showHiddenFields: true, ...o })
  expect(JSON.stringify(stored)).not.toContain('PRIVATE KEY')
  expect(JSON.stringify(stored)).not.toContain(hook)
  expect(JSON.stringify(stored)).toContain('secret')
  expect(String(stored.webhookSecret)).toMatch(/^enc:v1:/)
  const found = await payload.find({ collection: 'connections', where: { id: { equals: c.id } }, ...o })
  expect(JSON.stringify(found)).not.toContain(hook)
  expect(await connectionInput(payload, c.id)).toMatchObject({ secret: pem, config })
})

it('stores a gitlab Connection with its base URL', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'gl', slug: 'gl' }, ...o })
  const c = await payload.create({
    collection: 'connections',
    data: {
      name: 'gl',
      kind: 'gitlab',
      config: { baseUrl: 'https://git.einsfuenf.de' },
      secret: 'glpat',
      workspace: ws.id,
    },
    ...o,
  })
  expect(await payload.findByID({ collection: 'connections', id: c.id, ...o })).toMatchObject({
    kind: 'gitlab',
    config: { baseUrl: 'https://git.einsfuenf.de' },
  })
})

it('a repository or a ticket source blocks deleting its Product', async () => {
  const ws = await payload.create({ collection: 'workspaces', data: { name: 'bw', slug: 'bw' }, ...o })
  const make = async (slug: string) =>
    (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws.id }, ...o })).id as number
  const [a, b] = [await make('br'), await make('bs')]
  const connection = (
    await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws.id }, ...o })
  ).id as number
  expect(await blockedBy(payload, 'products', a)).toBe('')
  await payload.create({
    collection: 'repositories',
    data: { fullName: 'acme/br', product: a, workspace: ws.id },
    ...o,
  })
  await payload.create({
    collection: 'ticket_sources',
    data: { repo: 'acme/bs', product: b, connection, workspace: ws.id },
    ...o,
  })
  expect(await blockedBy(payload, 'products', a)).toBe('1 repositories')
  expect(await blockedBy(payload, 'products', b)).toBe('1 ticket sources')
})

it(
  'unlockBauherr and createWorkspace: Admin-only, unlock clears the ' +
    'lock, create adds the tenant and keeps slugs unique',
  async () => {
    const actions = await import('../src/app/(app)/(shell)/settings/actions')
    const admin = await payload.create({
      collection: 'bauherren',
      data: { email: 'adm@x.io', password: 'pw-123456', role: 'admin' },
      ...o,
    })
    const member = await payload.create({
      collection: 'bauherren',
      data: { email: 'mem@x.io', password: 'pw-123456', role: 'bauherr' },
      ...o,
    })
    const locked = await payload.create({
      collection: 'bauherren',
      data: { email: 'lock@x.io', password: 'pw-123456', role: 'bauherr' },
      ...o,
    })
    await payload.update({
      collection: 'bauherren',
      id: locked.id,
      data: { lockUntil: new Date(Date.now() + 600_000).toISOString(), loginAttempts: 5 },
      ...o,
    })
    const as = async (user: Bauherr) => {
      const session = await import('../src/app/(app)/lib/session')
      vi.spyOn(session, 'currentWorkspace').mockResolvedValue({ user, workspaces: [], workspace: null })
    }
    const form = (f: Record<string, string>) =>
      Object.entries(f).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData())

    const { loadBauherren } = await import('../src/app/(app)/lib/settings')
    const listed = await loadBauherren(bauherrOf(admin), null)
    expect(listed.find((b) => b.id === locked.id)?.locked).toBe(true)
    expect(listed.find((b) => b.id === member.id)?.locked).toBe(false)

    await as(bauherrOf(member))
    expect((await actions.unlockBauherr({}, form({ id: String(locked.id) }))).error).toBeTruthy()
    expect((await actions.createWorkspace({}, form({ name: 'Nope' }))).error).toBeTruthy()

    await as(bauherrOf(admin))
    expect((await actions.unlockBauherr({}, form({ id: String(locked.id) }))).saved).toBe(true)
    const after = lockState.parse(
      await payload.findByID({ collection: 'bauherren', id: locked.id, depth: 0, showHiddenFields: true, ...o }),
    )
    expect(after.lockUntil ?? null).toBeNull()
    expect(after.loginAttempts).toBe(0)

    expect((await actions.createWorkspace({}, form({ name: 'Second Workspace' }))).saved).toBe(true)
    const ws = (
      await payload.find({ collection: 'workspaces', where: { slug: { equals: 'second-workspace' } }, depth: 0, ...o })
    ).docs[0]
    expect(ws).toBeTruthy()
    const me = tenantsOf.parse(await payload.findByID({ collection: 'bauherren', id: admin.id, depth: 0, ...o }))
    expect(me.tenants.map((t) => t.tenant)).toContain(ws.id)
    expect((await actions.createWorkspace({}, form({ name: 'Again', slug: 'second-workspace' }))).error).toBeTruthy()
  },
)
