import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHECKPOINTS, type DecisionAction, buildDecision, canDecide, justDecided, sameDecision } from '../src/lib/decision'
import { NEEDS, type Need } from '../src/lib/needs-you'
import { GATES } from '../src/app/(app)/lib/gates'
import { byKind, DEFAULT, graph } from '../src/lib/workflow'
import { NEED_NODE } from '../src/lib/checkpoints'
import { parseTldr, tldrError } from '../src/lib/tldr'
import { decisionView, type Decision } from '../src/app/(app)/lib/plan'

const ACTIONS: DecisionAction[] = ['approvePlan', 'requestChanges', 'acceptStaging', 'approveProduction', 'grantRound', 'stopReview', 'backToBuild', 'backToBacklog', 'rerun', 'expedite', 'open']
const facts = {
  ticket: { id: 7, number: 7, title: 'Redirect the login to the page the person came from after signing in again', reviewRounds: 3, openCriticalDecisions: 2, releaseRunUrl: 'https://forge/runs/9' },
  product: { id: 3, name: 'Acme Web', stagingUrl: 'https://staging.example.com' },
  run: { id: 11, stage: 'build', status: 'needs_human', error: 'tests still red after 3 tries', reasonKind: 'stuck', findings: [{ severity: 'medium', file: 'src/a.ts', line: 4, msg: 'The retry never stops.' }, { severity: 'low', msg: 'nit' }] },
  mrUrl: 'https://forge/pull/12',
  planTldr: { decision: 'Approve the plan', recommendation: 'Approve; it touches one file and has a test.', why: ['One file changes', 'A regression test is added', 'No data is touched', 'extra fourth'], risk: 'none', options: ['Split it in two'] },
  stagingTldr: { whatYouGet: '- The login redirects back\n- Tests are green', found: '- Nothing recorded.' },
  productionGate: true,
  now: '2026-11-10T10:00:00.000Z',
}
const REAL = new Set<DecisionAction>(['approvePlan', 'requestChanges', 'acceptStaging', 'approveProduction', 'grantRound', 'stopReview', 'backToBuild', 'backToBacklog', 'rerun', 'expedite', 'open'])
const JARGON = /\b(Run|MR|WIP|sha|lease|stage label)\b/

describe('buildDecision', () => {
  it.each(NEEDS)('%s: follows the content rules', (need) => {
    const d = buildDecision(need, facts)
    expect(d.need).toBe(need)
    expect(CHECKPOINTS).toContain(d.checkpoint)
    expect(d.ask.length).toBeGreaterThan(10)
    expect(d.ask.length).toBeLessThanOrEqual(120)
    expect(d.ask).toMatch(/^[A-Z][A-Za-z-]+ /)
    expect(d.why.length).toBeLessThanOrEqual(3)
    expect(d.options.length).toBeGreaterThan(0)
    expect(d.options.filter((o) => o.primary)).toHaveLength(1)
    for (const o of d.options) {
      expect(REAL.has(o.action), o.label).toBe(true)
      expect(o.effect.length).toBeGreaterThan(5)
      if (o.action === 'open') expect(o.href).toBeTruthy()
    }
    expect(d.next.length).toBeGreaterThan(5)
    for (const text of [d.ask, d.recommendation ?? '']) expect(text).not.toMatch(JARGON)
    expect(d.preparedAt).toBe(facts.now)
    expect(d.openSince).toBe(facts.now)
  })

  it('every need has a gate and a decision', () => {
    for (const need of NEEDS) {
      expect(GATES[need], need).toBeTruthy()
      expect(buildDecision(need, facts).options.length).toBeGreaterThan(0)
    }
  })

  it('shortens a long title so the ask stays within 120 characters', () => {
    for (const need of NEEDS) expect(buildDecision(need, { ...facts, ticket: { ...facts.ticket, title: 'x'.repeat(400) } }).ask.length).toBeLessThanOrEqual(120)
  })

  it('the plan card is made from the plan summary and says so when there is none', () => {
    const d = buildDecision('Approve plan', facts)
    expect(d.recommendation).toBe('Approve; it touches one file and has a test.')
    expect(d.why).toEqual(['One file changes', 'A regression test is added', 'No data is touched'])
    expect(d.preparedBy).toBe('agent')
    expect(d.details).toContain('Split it in two')
    const bare = buildDecision('Approve plan', { ...facts, planTldr: null })
    expect(bare.why).toEqual(['The plan has no summary; open it to read it.'])
    expect(bare.recommendation).toBeNull()
    expect(bare.preparedBy).toBe('factory')
  })

  it('the staging and review-cap cards use the stored summary and findings', () => {
    const staging = buildDecision('Accept on staging', facts)
    expect(staging.why[0]).toBe('The login redirects back')
    expect(staging.evidence).toEqual(expect.arrayContaining([{ label: 'Staging', url: 'https://staging.example.com' }, { label: 'Change', url: 'https://forge/pull/12' }]))
    expect(staging.options.map((o) => o.action)).toEqual(['acceptStaging', 'requestChanges'])
    expect(staging.options[1]!.note).toBe('required')
    const cap = buildDecision('Round cap reached', facts)
    expect(cap.options.find((o) => o.action === 'stopReview')!.destructive).toBe(true)
    expect(cap.why.join(' ')).toContain('1 open finding')
    expect(cap.details).toContain('src/a.ts:4')
  })

  it('keeps openSince while the same need stays open, restarts it for a new one', () => {
    const first = buildDecision('Approve plan', facts)
    const later = buildDecision('Approve plan', { ...facts, now: '2026-11-10T12:00:00.000Z', previous: first })
    expect(later.openSince).toBe(first.openSince)
    expect(sameDecision(first, later)).toBe(true)
    expect(buildDecision('Answer decisions', { ...facts, now: '2026-11-10T12:00:00.000Z', previous: first }).openSince).toBe('2026-11-10T12:00:00.000Z')
  })

  it('an Expedite is an Admin decision, every other checkpoint belongs to the members', () => {
    expect(canDecide({ role: 'bauherr' }, 'Expedite?')).toBe(false)
    expect(canDecide({ role: 'admin' }, 'Expedite?')).toBe(true)
    for (const need of NEEDS.filter((n): n is Exclude<Need, 'Expedite?'> => n !== 'Expedite?')) expect(canDecide({ role: 'bauherr' }, need)).toBe(true)
  })

  it('a decision taken in the last 2 minutes keeps its need closed', () => {
    const t = { decidedNeed: 'Approve plan', decidedAt: '2026-11-10T10:00:00.000Z' }
    expect(justDecided(t, 'Approve plan', Date.parse('2026-11-10T10:01:59.000Z'))).toBe(true)
    expect(justDecided(t, 'Approve plan', Date.parse('2026-11-10T10:02:01.000Z'))).toBe(false)
    expect(justDecided(t, 'Approve production', Date.parse('2026-11-10T10:00:30.000Z'))).toBe(false)
    expect(justDecided({}, 'Approve plan')).toBe(false)
  })
})

const GOOD = '## TL;DR\nDecision: Approve the login fix\nRecommendation: Approve; one file changes.\nWhy:\n- One file\n- Test added\nRisk: none\nOptions:\n- Split it\n\n## Goal\n- x\n'

describe('plan TL;DR', () => {
  it('parses the labelled lines', () => {
    expect(parseTldr(GOOD).tldr).toEqual({ decision: 'Approve the login fix', recommendation: 'Approve; one file changes.', why: ['One file', 'Test added'], risk: 'none', options: ['Split it'] })
    expect(tldrError(GOOD)).toBeNull()
  })
  it('lists every missing line', () => {
    const e = tldrError('## TL;DR\nDecision: x\nWhy:\n- a\n\n## Goal\n- y')!
    expect(e).toContain('`Recommendation:`')
    expect(e).toContain('`Risk:`')
    expect(e).not.toMatch(/Missing:.*`Decision:`/)
  })
  it('refuses a plan without the section, a fifth bullet and a TL;DR that is not first', () => {
    expect(tldrError('## Goal\n- x\n## Steps\n1. y')).toContain('Missing: `Decision:`, `Recommendation:`, `Why:`, `Risk:`')
    expect(tldrError(GOOD.replace('- Test added', '- a\n- b\n- c'))).toContain('at most 3')
    expect(tldrError(`## Goal\n- x\n\n${GOOD}`)).toContain('must be the first section')
  })
  it('tolerates a title line and bold labels', () => {
    expect(tldrError('# Plan: x\n\n## TL;DR\n**Decision:** a\n**Recommendation:** b\n**Why:**\n- c\n**Risk:** none\n\n## Goal\n- z')).toBeNull()
  })
})

describe('checkpoint names', () => {
  it('a need that waits at a graph node carries exactly that node\'s title', () => {
    process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url)) // the pack with the plan, staging and production gates on
    const wf = DEFAULT()
    let compared = 0
    const titles = new Map(graph(wf).nodes.map((n) => [n.id, n.title]))
    for (const [need, [kind, suffix]] of Object.entries(NEED_NODE) as [Need, [Parameters<typeof byKind>[1], string]][]) {
      const title = titles.get(`${byKind(wf, kind)!.name}:${suffix}`)
      if (title) compared++
      if (title) expect(title, need).toBe(buildDecision(need, facts).checkpoint)
    }
    expect(compared).toBeGreaterThanOrEqual(5)
  })
})

describe('decisionView', () => {
  const rows: Decision[] = [
    { id: 'D1', title: 'Keep the cache?', critical: true, default: 'yes', options: ['yes', 'no'] },
    { id: 'D2', title: 'Show the banner?', critical: false, default: 'no', options: ['no', 'yes'] },
    { id: 'D3', title: 'Log the retries?', critical: false, default: 'yes', options: ['yes'] },
  ]

  it('keeps every unanswered row answerable while the Ticket is in Triage or Plan', () => {
    expect(decisionView(rows, {}, { stageKind: 'plan', approved: false })).toMatchObject({ open: 3, answerable: 3, defaults: [] })
    expect(decisionView(rows, {}, { stageKind: 'triage', approved: false })).toMatchObject({ open: 3, answerable: 3, defaults: [] })
  })

  it('past Plan no row is answerable and the unanswered rows are listed as defaults taken', () => {
    const view = decisionView(rows, { D2: 'yes' }, { stageKind: 'build', approved: false })
    expect(view).toMatchObject({ open: 2, answered: 1, answerable: 0 })
    expect(view.defaults.map((d) => [d.id, d.title, d.default])).toEqual([
      ['D1', 'Keep the cache?', 'yes'],
      ['D3', 'Log the retries?', 'yes'],
    ])
  })

  it('an approved plan is past Plan even in the Plan stage', () => {
    expect(decisionView(rows, {}, { stageKind: 'plan', approved: true })).toMatchObject({ answerable: 0, defaults: rows })
  })
})
