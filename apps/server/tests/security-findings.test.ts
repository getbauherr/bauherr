import { readFileSync } from 'node:fs'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let product: number
let anchor: Record<string, any>
const o = { overrideAccess: true } as const
const repo = 'acme/findings'
type F = { rootCause: string; title: string; severity: string; files: string[]; evidence: string; fix: string }
const finding = (n: number, severity = 'medium', extra: Partial<F> = {}): F => ({ rootCause: `Root cause ${n}`, title: `Finding ${n}`, severity, files: [`src/b${n}.ts`, `src/a${n}.ts`], evidence: 'e', fix: 'f', ...extra })

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('security_findings')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  const { anchorTicket } = await import('../src/lib/security-scan')
  anchor = await anchorTicket(payload, (await payload.findByID({ collection: 'products', id: product, depth: 0, ...o })) as Record<string, any>)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const scan = async (scanArtifact: unknown, status = 'succeeded') => {
  const { fileFindings } = await import('../src/lib/security-scan')
  const run = await payload.create({ collection: 'runs', data: { ticket: anchor.id, stage: 'scan', mode: 'autonomous', status, workspace: anchor.workspace, artifacts: { scan: scanArtifact } }, ...o })
  const result = await fileFindings(payload, run)
  return { run, result }
}
const findingTickets = () => fake.tickets(repo).list({ labels: ['bauherr:security'], state: 'all' })
const calls = () => {
  const ts = fake.tickets(repo)
  const spies = { list: vi.spyOn(ts, 'list'), create: vi.spyOn(ts, 'create'), comment: vi.spyOn(ts, 'comment') }
  return { spies, restore: () => Object.values(spies).forEach((s) => s.mockRestore()) }
}

it('the first scan files one Ticket per finding with marker and labels; critical and high enter triage; a re-scan files 0', async () => {
  const findings = [finding(1, 'critical'), finding(2, 'high'), finding(3, 'medium'), finding(4, 'low')]
  const c = calls()
  const first = await scan(findings)
  expect(first.result).toEqual({ created: 4, seen: 0 })
  expect(c.spies.list).toHaveBeenCalledTimes(1)
  expect(c.spies.create).toHaveBeenCalledTimes(4)
  c.restore()
  const filed = await findingTickets()
  expect(filed).toHaveLength(4)
  const by = (t: string) => filed.find((x) => x.title === t)!
  expect(by('Finding 1').labels.sort()).toEqual(['bauherr:security', 'bauherr:stage:triage', 'security:critical'])
  expect(by('Finding 2').labels).toContain('bauherr:stage:triage')
  expect(by('Finding 3').labels.sort()).toEqual(['bauherr:security', 'security:medium'])
  expect(by('Finding 4').labels).not.toContain('bauherr:stage:triage')
  expect(by('Finding 1').body).toMatch(/^<!-- bauherr:security-finding:[0-9a-f]{12} -->/)

  const again = calls()
  const second = await scan(findings)
  expect(second.result).toEqual({ created: 0, seen: 4 })
  expect(again.spies.create).not.toHaveBeenCalled()
  expect(again.spies.comment).not.toHaveBeenCalled()
  again.restore()
  expect(await findingTickets()).toHaveLength(4)
})

it('the key ignores file order, line numbers, case and whitespace of the root cause', async () => {
  const { findingKey } = await import('../src/lib/security-scan')
  const a = findingKey('web', { rootCause: 'SQL  injection', files: ['b.ts', 'a.ts'] })
  expect(findingKey('web', { rootCause: ' sql injection ', files: ['a.ts', 'b.ts'] })).toBe(a)
  expect(findingKey('api', { rootCause: 'sql injection', files: ['a.ts', 'b.ts'] })).not.toBe(a)
  const before = (await findingTickets()).length
  const r = await scan([finding(1, 'critical', { files: ['src/a1.ts', 'src/b1.ts'] })])
  expect(r.result.created).toBe(0)
  expect((await findingTickets()).length).toBe(before)
})

it('a closed finding only gets a Comment and stays closed', async () => {
  const t = (await findingTickets()).find((x) => x.title === 'Finding 4')!
  await fake.tickets(repo).close(String(t.number), 'completed')
  const r = await scan([finding(4, 'low')])
  expect(r.result).toEqual({ created: 0, seen: 1 })
  const after = await fake.tickets(repo).get(String(t.number))
  expect(after.state).toBe('closed')
  const comments = await fake.tickets(repo).listComments(String(t.number))
  expect(comments.map((c) => c.body)).toEqual([`Seen again in scan Run #${r.run.id}.`])
})

it('a severity increase on an open finding adds a Comment and swaps the label', async () => {
  const t = (await findingTickets()).find((x) => x.title === 'Finding 3')!
  const r = await scan([finding(3, 'high')])
  expect(r.result.created).toBe(0)
  const after = await fake.tickets(repo).get(String(t.number))
  expect(after.labels).toContain('security:high')
  expect(after.labels).not.toContain('security:medium')
  expect((await fake.tickets(repo).listComments(String(t.number))).at(-1)!.body).toContain('raised from medium to high')
})

it('at most 10 new Tickets per scan, highest severity first, overflow in one Comment on the anchor; scrubs evidence', async () => {
  const many = Array.from({ length: 12 }, (_, i) => finding(100 + i, i === 11 ? 'critical' : 'low', i === 11 ? { evidence: `token ghp_${'a'.repeat(30)} ${'x'.repeat(3000)}` } : {}))
  const c = calls()
  const r = await scan(many)
  expect(r.result.created).toBe(10)
  expect(c.spies.create).toHaveBeenCalledTimes(10)
  expect(c.spies.comment).toHaveBeenCalledTimes(1)
  expect(c.spies.comment.mock.calls[0]![0]).toBe(String(anchor.number))
  c.restore()
  const filed = await findingTickets()
  const critical = filed.find((x) => x.title === 'Finding 111')!
  expect(critical).toBeTruthy()
  expect(critical.body).not.toContain('ghp_')
  expect(critical.body!.length).toBeLessThan(2400)
  expect(filed.filter((x) => /^Finding 1\d\d$/.test(x.title))).toHaveLength(10)
})

it('malformed findings file nothing and set the Run error', async () => {
  const before = (await findingTickets()).length
  const c = calls()
  const bad = await scan([{ title: 'no root cause', severity: 'high' }])
  expect(bad.result).toEqual({ created: 0, seen: 0 })
  expect(c.spies.create).not.toHaveBeenCalled()
  c.restore()
  const run = await payload.findByID({ collection: 'runs', id: bad.run.id, depth: 0, ...o })
  expect(run.error).toMatch(/findings: .*entry 0/)
  expect(run.status).toBe('failed')
  expect((await scan({ not: 'an array' })).result.created).toBe(0)
  expect((await findingTickets()).length).toBe(before)
})

it('a partial budget_exhausted Run still files its findings', async () => {
  const r = await scan([finding(200, 'medium')], 'budget_exhausted')
  expect(r.result.created).toBe(1)
  expect((await findingTickets()).some((x) => x.title === 'Finding 200')).toBe(true)
})

it('accepts the {"findings": [...]} file exactly as pack/skills/security-scan/SKILL.md specifies, and scrubs token-like titles', async () => {
  const skill = readFileSync(new URL('../../../pack/skills/security-scan/SKILL.md', import.meta.url), 'utf8')
  expect(skill).toContain('{"findings":[{"rootCause","title","severity","files":["path"],"evidence","fix"}]}')
  const file = { findings: [{ rootCause: 'Missing check on export routes', title: `Export leaks ghp_${'b'.repeat(30)}`, severity: 'high', files: ['src/export.ts'], evidence: 'The route reads without a check.', fix: 'Add the check.' }] }
  const r = await scan(file)
  expect(r.result.created).toBe(1)
  const filed = (await findingTickets()).find((x) => x.title.startsWith('Export leaks'))!
  expect(filed.title).toBe('Export leaks [redacted]')
  expect((await scan({ findings: [] })).result).toEqual({ created: 0, seen: 0 })
})
