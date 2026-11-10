import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEMPLATE_NAMES, lintTemplate, packTemplate, parseSections, renderTemplate } from '../src/lib/templates'
import { createTestDb, type TestDb } from './helpers/test-db'

const tpl = (body: string, layout: 'tight' | 'normal' = 'normal') => ({ parsed: parseSections(body), layout, fallback: { gone: { heading: 'Gone section', level: 2 } } })

describe('render and lint', () => {
  it('fills sections in the template order under its heading text, without guidance', () => {
    const t = tpl('## Second {#b}\n<!-- guide -->\n\n## First {#a}\n<!-- guide -->\n\n## Fixed\nstays')
    expect(renderTemplate(t, { a: 'A text', b: 'B text' })).toBe('## Second\n\nB text\n\n## First\n\nA text\n\n## Fixed\n\nstays')
  })
  it('leaves out a section nothing fills, appends unknown content under the pack heading, and honours the tight layout', () => {
    expect(renderTemplate(tpl('## One {#a}\n## Two {#b}', 'tight'), { a: 'x', gone: 'y' })).toBe('## One\nx\n\n## Gone section\ny')
    expect(renderTemplate(tpl('### Level 3 {#a}'), { a: 'x' })).toBe('### Level 3\n\nx')
  })
  it('every pack template parses and passes its own lint', () => {
    for (const name of TEMPLATE_NAMES) {
      const t = packTemplate(name)
      expect(t.sections.length, name).toBeGreaterThan(0)
      expect(t.title && t.usedBy && t.description, name).toBeTruthy()
      expect(lintTemplate(name, t.body).filter((f) => f.level === 'error'), name).toEqual([])
    }
  })
  it('names what the code depends on', () => {
    const messages = (name: Parameters<typeof lintTemplate>[0], body: string) => lintTemplate(name, body).map((f) => f.message).join('|')
    expect(messages('staging-summary', '## What you get {#what-you-get}')).toContain('{#accept}')
    expect(messages('plan', packTemplate('plan').body.replace('## Goal {#goal}', '## Aim {#goal}'))).toContain('must stay "Goal"')
    expect(messages('plan', packTemplate('plan').body.replace('## TL;DR {#tldr}', '## Summary {#tldr}'))).toBe('')
    expect(messages('plan', packTemplate('plan').body.replace('Risk:', 'Danger:'))).toContain('"Risk:"')
    expect(messages('worklog', '## Worklog {#worklog}\n**Goal**')).toContain('**Current instructions**')
    expect(messages('request', '## Problem {#problem}\n## Problem {#context}\n## Acceptance criteria {#acceptance-criteria}\n## X {#problem}')).toContain('share the anchor')
    expect(messages('decision', '   ')).toContain('empty')
  })
})

let payload: Payload
let fake: FakeBackend
let testDb: TestDb
let ws: number
const o = { overrideAccess: true } as const
const repo = 'acme/web'

describe('Workspace templates', () => {
  beforeAll(async () => {
    testDb = await createTestDb('templates')
    process.env.DATABASE_URL = testDb.url
    process.env.PAYLOAD_SECRET ??= 'test-secret'
    process.env.ENCRYPTION_KEY ??= 'test-key'
    process.env.BAUHERR_E2E_FAKE_FORGE = '1'
    process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
    delete process.env.GATEWAY_ADMIN_URL
    const { getPayload } = await import('payload')
    payload = await getPayload({ config: (await import('../src/payload.config')).default })
    fake = (await import('../src/lib/fake-forge')).fakeForge()
    ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  }, 120_000)
  afterAll(async () => {
    await payload?.destroy()
    await testDb?.drop(payload)
  })
  const input = { ticket: { number: 85, title: 'Dark theme', url: 'https://x/85' }, plan: '## Goal\n- Users can switch', worklog: '**Goal**\n- [x] A', mrs: [{ number: 7, url: 'https://x/pull/7', title: 'Dark', body: '## Review\n- label missing' }], evidence: null, stagingUrl: null, mergeSha: null }

  it('the pack template applies until the Workspace saves one, and Reset (delete) brings it back', async () => {
    const { template } = await import('../src/lib/templates')
    expect(await template(payload, ws, 'decision')).toMatchObject({ source: 'pack' })
    const row = await payload.create({ collection: 'templates', data: { name: 'decision', body: '## Ask {#decision}\n', workspace: ws } as never, ...o })
    expect(await template(payload, ws, 'decision')).toMatchObject({ source: 'workspace', sections: ['Ask'] })
    await payload.delete({ collection: 'templates', id: row.id, ...o })
    expect(await template(payload, ws, 'decision')).toMatchObject({ source: 'pack' })
  })

  it('a renamed and reordered staging-summary template gives that structure, and the TL;DR is still extracted', async () => {
    const { template, headingOf } = await import('../src/lib/templates')
    const { buildStagingSummary } = await import('../src/lib/summary')
    const { stagingTldrOf } = await import('../src/lib/decision')
    await payload.create({ collection: 'templates', data: { name: 'staging-summary', body: '## Check this first {#accept}\n\n## Result {#what-you-get}\n\n## Surprises {#found}\n', workspace: ws } as never, ...o })
    const custom = await template(payload, ws, 'staging-summary')
    const md = buildStagingSummary(input, custom)
    expect([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['Check this first', 'Result', 'Surprises', 'Decisions taken', 'Open'])
    // sections the template dropped keep their content, appended under the pack's heading
    const tldr = stagingTldrOf(md, { whatYouGet: headingOf(custom, 'what-you-get'), found: headingOf(custom, 'found') })
    expect(tldr.whatYouGet).toContain('Users can switch')
    expect(tldr.found).toContain('label missing')
  })

  it('load_skill ends the run-contract with the Workspace\'s plan and worklog templates', async () => {
    const { callTool } = await import('../src/lib/mcp-tools')
    delete process.env.BAUHERR_PACK_DIR // the fixture pack has no skills; the repo's pack does
    const user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
    await payload.create({ collection: 'templates', data: { name: 'plan', body: '## Short answer {#tldr}\nDecision: <d>\nRecommendation: <r>\nWhy:\n- <w>\nRisk: <r>\n\n## Goal {#goal}\n\n## Steps {#steps}\n', workspace: ws } as never, ...o })
    const text = (await callTool({ payload, user, actor: { kind: 'human' }, workspace: ws } as never, 'load_skill', { name: 'run-contract' })) as string
    expect(text).toContain('## Template: Plan')
    expect(text).toContain('## Short answer')
    expect(text).not.toContain('{#tldr}')
    expect(text).toContain('## Template: Worklog')
    expect(await callTool({ payload, user, actor: { kind: 'human' }, workspace: ws } as never, 'load_skill', { name: 'worklog' })).not.toContain('## Template:')
  })

  it('a plan under the renamed TL;DR heading is accepted and stored', async () => {
    const { callTool } = await import('../src/lib/mcp-tools')
    const user = (await payload.find({ collection: 'bauherren', limit: 1, ...o })).docs[0]!
    const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
    const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
    const issue = await fake.tickets(repo).create({ title: 'x' })
    const ticket = await payload.create({ collection: 'tickets', data: { title: 'x', externalId: String(issue.number), number: issue.number, state: 'open', labels: [], stage: 'plan', product, workspace: ws }, ...o })
    const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'plan', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
    const call = (name: string, i: unknown) => callTool({ payload, user, actor: { kind: 'human' } } as never, name, i) as Promise<any>
    const { leaseToken } = await call('claim_run', { runId: run.id })
    await expect(call('submit_plan', { runId: run.id, leaseToken, markdown: '## TL;DR\nDecision: d\nRecommendation: r\nWhy:\n- w\nRisk: none\n\n## Goal\n- x' })).rejects.toThrow('## Short answer')
    await call('submit_plan', { runId: run.id, leaseToken, markdown: '## Short answer\nDecision: d\nRecommendation: r\nWhy:\n- w\nRisk: none\n\n## Goal\n- x' })
    expect(((await payload.findByID({ collection: 'tickets', id: ticket.id, depth: 0, ...o })) as Record<string, any>).planTldr).toMatchObject({ decision: 'd' })
  })
})
