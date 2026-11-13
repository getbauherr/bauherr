import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DEFAULT } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
const o = { overrideAccess: true, depth: 0 } as const
const repo = 'acme/web'
const day = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * day).toISOString()
const sha = (n: number) => `${n}`.repeat(7).slice(0, 7).padEnd(7, 'a')

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('docs_check')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const prod = async () => (await payload.findByID({ collection: 'products', id: product, ...o })) as Record<string, any>

/** A Ticket of the Product that entered the release stage `days` ago with a merge commit. */
const merged = async (number: number, days: number, mergeSha: string | null = sha(number)) => {
  const t = await payload.create({ collection: 'tickets', data: { title: `Ticket ${number}`, externalId: `m${number}`, number, url: `https://x/${number}`, state: 'open', stage: 'release', product, workspace: ws, ...(mergeSha && { mergeSha }) } as never, ...o })
  await payload.create({ collection: 'ticket_events', data: { ticket: t.id, workspace: ws, at: ago(days), stage: 'release', stageKind: 'release', phase: 'human', cause: 'test' } as never, ...o })
  return t
}

const docsRun = async (artifacts: unknown) => {
  const { startDocsCheck } = await import('../src/lib/docs-check')
  const { run } = await startDocsCheck(payload, product)
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'succeeded' }, ...o })
  const row = (await payload.findByID({ collection: 'runs', id: run.id, ...o })) as Record<string, any>
  return { ...row, artifacts: { docs: artifacts } } as Record<string, any>
}
const docsTickets = async () => (await fake.tickets(repo).list({ labels: ['bauherr:docs'], state: 'all' }))
const finding = { stale: [{ file: 'README.md', claim: 'The export has two formats', commit: sha(1), fix: 'The export has three formats.' }], missing: [{ ticket: 2, commit: sha(2), feature: 'CSV export', file: 'docs/export.md' }] }

it('docs is a reserved, autonomous, unclaimable system Run kind that never escalates', async () => {
  const { RESERVED } = await import('../src/lib/workflow-rules')
  const { runKind, runStageError } = await import('../src/lib/stage-text')
  const { resolveMode } = await import('../src/lib/mode')
  const { nextStep } = await import('../src/lib/escalation')
  const { baseCaps } = await import('../src/lib/investigation')
  const { callTool } = await import('../src/lib/mcp-tools')
  const { startDocsCheck } = await import('../src/lib/docs-check')
  expect(RESERVED).toContain('docs')
  expect(runStageError(DEFAULT(), 'docs')).toBe(true)
  expect(runKind(DEFAULT(), 'docs')).toBe('docs')
  expect(resolveMode(DEFAULT(), { defaultMode: 'session' }, 'docs')).toBe('autonomous')
  expect(nextStep({ stage: 'docs', status: 'failed' }, false)).toBe('owner')
  expect(baseCaps('docs')).toEqual({ maxTurns: 60, maxBudgetUsd: 2 })
  expect((await import('../src/jobs')).excludedLabels(DEFAULT())).toContain('bauherr:docs-check')

  const { run, created } = await startDocsCheck(payload, product)
  expect(created).toBe(true)
  expect(run).toMatchObject({ stage: 'docs', mode: 'autonomous', status: 'queued' })
  const user = await payload.create({ collection: 'bauherren', data: { email: 'docs@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  await expect(callTool({ payload, user, actor: { kind: 'human' } } as never, 'claim_run', { runId: run.id })).rejects.toThrow(/not awaiting_session/)
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'cancelled' }, ...o })
})

it('a second start while a check is active reuses the Run and the one anchor Ticket', async () => {
  const { startDocsCheck, DOCS_CHECK_LABEL } = await import('../src/lib/docs-check')
  const first = await startDocsCheck(payload, product)
  const second = await startDocsCheck(payload, product)
  expect([first.created, second.created]).toEqual([true, false])
  expect(second.run.id).toBe(first.run.id)
  expect((await payload.find({ collection: 'tickets', where: { labels: { equals: DOCS_CHECK_LABEL } }, ...o })).docs).toHaveLength(1)
  await payload.update({ collection: 'runs', id: first.run.id, data: { status: 'cancelled' }, ...o })
})

it('parseDocsFindings accepts the skill format and rejects shape errors', async () => {
  const { parseDocsFindings } = await import('../src/lib/docs-check')
  expect(parseDocsFindings({ stale: [], missing: [] })).toEqual({ stale: [], missing: [] })
  expect(parseDocsFindings({ ...finding, missing: [{ ...finding.missing[0], ticket: '2' }] }).missing[0]!.ticket).toBe(2)
  for (const bad of [null, [], { stale: [] }, { stale: [{ file: 'a.md' }], missing: [] }, { stale: [], missing: [{ ...finding.missing[0], commit: 'not a sha' }] }, { stale: [{ ...finding.stale[0], commit: 'HEAD' }], missing: [] }]) {
    expect(() => parseDocsFindings(bad)).toThrow(/docs-findings\.json/)
  }
})

it('mergedSince counts from the last finished check, else the last release, else 30 days', async () => {
  const { mergedSince, sinceOf, docsContext, DEFAULT_DOCS_PATHS } = await import('../src/lib/docs-check')
  await merged(101, 40)
  await merged(102, 20)
  await merged(103, 5)
  await merged(104, 4, null)
  const numbers = async () => (await mergedSince(payload, await prod())).map((m) => m.number)
  expect(await numbers()).toEqual([102, 103])
  await payload.update({ collection: 'products', id: product, data: { lastReleaseAt: ago(10) }, ...o })
  expect(await numbers()).toEqual([103])
  await payload.update({ collection: 'products', id: product, data: { docsCheck: { lastCheckAt: ago(30) } }, ...o })
  expect(await numbers()).toEqual([102, 103])
  expect(sinceOf(await prod()).getTime()).toBeLessThan(Date.now() - 29 * day)
  expect(await docsContext(payload, await prod())).toEqual({ paths: DEFAULT_DOCS_PATHS, merged: [{ number: 102, title: 'Ticket 102', mergeSha: sha(102) }, { number: 103, title: 'Ticket 103', mergeSha: sha(103) }] })
  await payload.update({ collection: 'products', id: product, data: { docsCheck: { lastCheckAt: null }, lastReleaseAt: null }, ...o })
})

it('findings file exactly one docs Ticket in Plan; the next check updates it in place; a Run is filed once', async () => {
  const { fileDocsTicket } = await import('../src/lib/docs-check')
  const first = await docsRun(finding)
  expect(await fileDocsTicket(payload, first)).toEqual({ filed: 'created' })
  const [issue, ...rest] = await docsTickets()
  expect(rest).toHaveLength(0)
  expect(issue!.title).toMatch(/^Docs update \d{4}-\d\d-\d\d: web$/)
  expect(issue!.labels).toEqual(expect.arrayContaining(['bauherr:docs', 'bauherr:type:change', 'bauherr:stage:plan']))
  expect(issue!.body).toContain('- [ ] `README.md` is stale: The export has two formats')
  expect(issue!.body).toContain(`commit \`${sha(2)}\``)
  const row = (await payload.find({ collection: 'tickets', where: { number: { equals: issue!.number } }, ...o })).docs[0] as Record<string, any>
  expect(row).toMatchObject({ stage: 'plan', product })
  expect(((await prod()).docsCheck as Record<string, unknown>).lastCheckRun).toBe(first.id)

  expect(await fileDocsTicket(payload, first)).toEqual({ filed: 'none' })
  const second = await docsRun({ stale: [], missing: [finding.missing[0]] })
  expect(await fileDocsTicket(payload, second)).toEqual({ filed: 'updated' })
  const after = await docsTickets()
  expect(after).toHaveLength(1)
  expect(after[0]!.body).toContain(`docs check Run #${second.id}`)
  expect(after[0]!.body).not.toContain('is stale')
})

it('findings beyond 30 are listed as overflow, not as criteria', async () => {
  const { docsTicketBody } = await import('../src/lib/docs-check')
  const stale = Array.from({ length: 32 }, (_, i) => ({ file: `d${i}.md`, claim: `claim ${i}`, commit: sha(1), fix: 'fix' }))
  const body = docsTicketBody({ id: 9 }, ['README.md'], { stale, missing: [] })
  expect(body.match(/^- \[ \]/gm)).toHaveLength(30)
  expect(body).toContain('## Not listed (over 30)')
  expect(body).toContain('- `d31.md` is stale')
})

it('zero findings file nothing and record the check; a bad file fails the Run and records nothing', async () => {
  const { fileDocsTicket } = await import('../src/lib/docs-check')
  for (const t of await docsTickets()) await fake.tickets(repo).close(String(t.number), 'completed')
  const before = (await docsTickets()).length
  const empty = await docsRun({ stale: [], missing: [] })
  expect(await fileDocsTicket(payload, empty)).toEqual({ filed: 'none' })
  expect(await docsTickets()).toHaveLength(before)
  expect(((await prod()).docsCheck as Record<string, unknown>).lastCheckRun).toBe(empty.id)

  const bad = await docsRun({ stale: 'nope' })
  expect(await fileDocsTicket(payload, bad)).toEqual({ filed: 'none' })
  expect(await docsTickets()).toHaveLength(before)
  expect((await payload.findByID({ collection: 'runs', id: bad.id, ...o })).status).toBe('failed')
  expect(((await prod()).docsCheck as Record<string, unknown>).lastCheckRun).toBe(empty.id)
})
