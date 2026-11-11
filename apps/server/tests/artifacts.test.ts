import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let outsider: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const RULE = { name: 'UI screenshots', globs: ['src/ui/**'], kind: 'image', command: 'pnpm shots', before: true }
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** EBML header with DocType "webm". */
const WEBM = Buffer.concat([Buffer.from('1a45dfa3a3', 'hex'), Buffer.from('4286810142f7810142f2810442f38108', 'hex'), Buffer.from('428284', 'hex'), Buffer.from('webm'), Buffer.from('4287810442858102', 'hex')]).toString('base64')

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('artifacts')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  const other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example.com' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  outsider = await payload.create({ collection: 'bauherren', data: { email: 'o@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  for (const pr of await fake.forge.listPullRequests(repo, 'open')) await fake.forge.closePullRequest(repo, pr.number)
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: { artifacts: [RULE] } }, ...o })
})

/** A claimed session build Run and an open factory MR holding `files`. */
const seed = async (files: Record<string, string>) => {
  const number = ++n
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: `a-${number}`, number, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  const head = `bauherr/${number}-${n}`
  await fake.forge.createBranch(repo, head)
  for (const [path, content] of Object.entries(files)) fake.commit(repo, head, path, content)
  const pr = await fake.forge.openPullRequest(repo, { title: 't', body: 'b', head, base: 'main' })
  return { ticket, run, a: { runId: run.id, leaseToken }, pr }
}
const shot = { kind: 'image', title: 'Settings page after', rule: RULE.name, criterion: 'The save button is visible', file: { name: 'a.png', base64: PNG } }
const rows = async (ticket: number) => (await payload.find({ collection: 'artifacts', where: { ticket: { equals: ticket } }, sort: 'id', depth: 0, ...o })).docs as Record<string, any>[]

it('request_review is refused naming the rule and its command, and passes once the proof is attached on the head', async () => {
  const { ticket, a } = await seed({ 'src/ui/a.tsx': 'x' })
  await expect(call(member, 'request_review', a)).rejects.toThrow(/No proof "UI screenshots" \(image\).*`pnpm shots`.*attach_artifact.*No artifact: UI screenshots: <reason>/)
  expect((await call(member, 'run_checks', a)).failures).toHaveLength(1)
  await call(member, 'attach_artifact', { ...a, ...shot, pair: 'after' })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
  expect(await rows(ticket.id as number)).toHaveLength(1)
})

it('a rule whose paths did not change asks for nothing', async () => {
  const { a } = await seed({ 'src/api/a.ts': 'x' })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
})

it('proof made on an older head does not count: the head moved', async () => {
  const { a, pr } = await seed({ 'src/ui/a.tsx': 'x' })
  await call(member, 'attach_artifact', { ...a, ...shot })
  fake.commit(repo, pr.head, 'src/ui/b.tsx', 'y')
  await expect(call(member, 'request_review', a)).rejects.toThrow('No proof "UI screenshots"')
})

it('the Evidence line "No artifact: <rule>: <reason>" is the way out; it is stored and shown to the human', async () => {
  const { ticket, a } = await seed({ 'src/ui/a.tsx': 'x' })
  await call(member, 'attach_evidence', { ...a, markdown: 'No artifact: UI screenshots: the change is a hidden flag' })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
  const stored = await rows(ticket.id as number)
  expect(stored).toMatchObject([{ waived: true, rule: 'UI screenshots', text: 'the change is a hidden flag' }])
  const { loadProof } = await import('../src/app/(app)/lib/proof')
  const t = (await payload.findByID({ collection: 'tickets', id: ticket.id, depth: 0, ...o })) as Record<string, any>
  const p = (await payload.findByID({ collection: 'products', id: product, depth: 0, ...o })) as Record<string, any>
  expect((await loadProof(payload, [t], new Map([[product, p]]))).get(ticket.id as number)).toMatchObject({ waived: [{ rule: 'UI screenshots', reason: 'the change is a hidden flag' }], staging: 'https://staging.example.com' })
})

it('a waiver for a name that is no rule of the Product is ignored', async () => {
  const { a } = await seed({ 'src/ui/a.tsx': 'x' })
  await call(member, 'attach_evidence', { ...a, markdown: 'No artifact: Something else: whatever' })
  await expect(call(member, 'request_review', a)).rejects.toThrow('No proof "UI screenshots"')
})

it('attach_artifact is idempotent per (run, rule, pair, commit) and groups under the request\'s criteria', async () => {
  const { ticket, run, a } = await seed({ 'src/ui/a.tsx': 'x' })
  const first = await call(member, 'attach_artifact', { ...a, ...shot, pair: 'before' })
  expect(first).toMatchObject({ ok: true, created: true })
  expect(await call(member, 'attach_artifact', { ...a, ...shot, pair: 'before' })).toMatchObject({ created: false, artifact: first.artifact })
  await call(member, 'attach_artifact', { ...a, ...shot, pair: 'after', title: 'Settings page before' })
  await call(member, 'attach_artifact', { ...a, kind: 'transcript', title: 'Session', text: '$ pnpm test\nok', criterion: 'Tests pass' })
  await call(member, 'attach_artifact', { ...a, kind: 'preview', title: 'Try the new page', url: 'https://preview.example.com/p/1', criterion: 'The save button is visible' })
  expect(await rows(ticket.id as number)).toHaveLength(4)
  const session = await payload.create({ collection: 'intake_sessions', data: { product, workspace: ws, status: 'submitted', ticketNumber: ticket.number, draft: { acceptance_criteria: ['The save button is visible', 'Existing data is kept'] } } as never, ...o })
  expect(session.id).toBeTruthy()
  const { loadProof } = await import('../src/app/(app)/lib/proof')
  const t = (await payload.findByID({ collection: 'tickets', id: ticket.id, depth: 0, ...o })) as Record<string, any>
  const p = (await payload.findByID({ collection: 'products', id: product, depth: 0, ...o })) as Record<string, any>
  const view = (await loadProof(payload, [t], new Map([[product, p]]))).get(ticket.id as number)!
  expect(view.rows.map((r) => [r.criterion, r.items.map((i) => i.kind + (i.pair ? `:${i.pair}` : ''))])).toEqual([
    ['The save button is visible', ['image:before', 'image:after', 'preview']],
    ['Existing data is kept', []],
    ['Tests pass', ['transcript']],
  ])
  expect(run.id).toBeTruthy()
})

it('files are checked by content, not by name or claimed kind; bad URLs, oversized and unknown input are refused', async () => {
  const { a } = await seed({ 'src/ui/a.tsx': 'x' })
  const fail = (input: Record<string, unknown>, text: RegExp) => expect(call(member, 'attach_artifact', { ...a, title: 't', ...input })).rejects.toThrow(text)
  await fail({ kind: 'image', file: { name: 'a.png', base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') } }, /only png, jpeg or webp/)
  await fail({ kind: 'recording', file: { name: 'a.webm', base64: PNG } }, /webm or mp4/)
  await fail({ kind: 'preview', url: 'javascript:alert(1)' }, /http\(s\)/)
  await fail({ kind: 'transcript', file: { base64: Buffer.from([0, 1, 2]).toString('base64') } }, /UTF-8 text/)
  await fail({ kind: 'sample', text: 'x'.repeat(200 * 1024 + 1) }, /larger than 200 KB/)
  await fail({ kind: 'image', file: { base64: PNG }, text: 'also text' }, /exactly one/)
  await fail({ kind: 'sample', text: 'x', pair: 'before' }, /images only/)
  await fail({ kind: 'movie', text: 'x' }, /kind must be/)
  await expect(call(member, 'attach_artifact', { ...a, kind: 'recording', title: 'Clip', file: { name: 'a.webm', base64: WEBM } })).resolves.toMatchObject({ ok: true })
})

it('an agent in another Workspace cannot attach to this Run', async () => {
  const { a } = await seed({ 'src/ui/a.tsx': 'x' })
  await expect(call(outsider, 'attach_artifact', { ...a, ...shot })).rejects.toThrow()
})

it('the artifact file route serves members only, with safe headers and no public link', async () => {
  const { ticket, a } = await seed({ 'src/ui/a.tsx': 'x' })
  const { artifact } = await call(member, 'attach_artifact', { ...a, ...shot })
  const { text } = await call(member, 'attach_artifact', { ...a, kind: 'report', title: 'Contract', text: '<script>alert(1)</script>' }).then(async (r) => ({ text: r.artifact }))
  const { GET } = await import('../src/app/api/tickets/[id]/artifacts/[artifactId]/route')
  const as = async (user: Record<string, any> | null, ticketId: number, id: number, query = '') => {
    const token = user ? (await payload.login({ collection: 'bauherren', data: { email: user.email, password: 'pw-123456' } })).token : null
    return GET(new Request(`http://x/api/tickets/${ticketId}/artifacts/${id}${query}`, { headers: token ? { authorization: `JWT ${token}` } : {} }), { params: Promise.resolve({ id: String(ticketId), artifactId: String(id) }) })
  }
  const ok = await as(member, ticket.id as number, artifact)
  expect(ok.status).toBe(200)
  expect(ok.headers.get('content-type')).toBe('image/png')
  expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
  expect(ok.headers.get('content-disposition')).toMatch(/^inline; filename="artifact-\d+\.png"$/)
  expect((await as(member, ticket.id as number, artifact, '?download=1')).headers.get('content-disposition')).toMatch(/^attachment/)
  const plain = await as(member, ticket.id as number, text)
  expect(plain.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(plain.headers.get('content-disposition')).toMatch(/^attachment/)
  expect((await as(outsider, ticket.id as number, artifact)).status).toBe(404)
  expect((await as(null, ticket.id as number, artifact)).status).toBe(401)
  expect((await as(member, (ticket.id as number) + 99, artifact)).status).toBe(404)
})

it('artifacts take no writes over REST', async () => {
  const { ticket } = await seed({ 'src/ui/a.tsx': 'x' })
  const { access } = payload.collections.artifacts.config
  for (const op of ['create', 'update', 'delete'] as const) expect(await (access[op] as () => unknown)()).toBe(false)
  expect(ticket.id).toBeTruthy()
})
