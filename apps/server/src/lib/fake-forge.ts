import { FakeBackend } from '@bauherr/adapters'

/** E2E only (`BAUHERR_E2E_FAKE_FORGE=1`): in-memory forge holding the seeded Ticket #1 of `acme/web` with a plan and a worklog, and the Knowledge repo `acme/knowledge`. */
const PLAN = `<!-- bauherr:plan -->
# Plan: dark theme for the dashboard

## Steps
1. Add colour tokens for the dark palette
2. Wire the theme toggle into the top bar

## Decisions

- **D1 Where to store the choice**. Default: localStorage. Alternative: a cookie.
- **D2 Follow the system setting, critical**. Default: yes, until the user picks. Alternative: never, always light first.
`

const WORKLOG = `<!-- bauherr:worklog -->
## Worklog
**Goal**
- [ ] A dark theme exists

**Decisions**
- 2026-10-30 Use CSS custom properties. Consequence: no runtime theme library. By: plan Run.
`

const QUESTIONS = `<!-- bauherr:triage -->
## Questions
Triage needs your answers before this Ticket can be planned: the export scope is open.

## Decisions
- **D1 Which export format, critical**. Default: CSV. Alternatives: XLSX; JSON.
`

const summary = (n: number) => `<!-- bauherr:staging-summary -->

# Staging summary: #${n} Ship the export

## What you get

CSV export for invoices.

## Accept

Check it on staging, then accept.
`

const build = (): FakeBackend => {
  const fake = new FakeBackend({ native: true, users: ['fake', 'e2e-admin'] })
  fake.commit('acme/knowledge', 'main', 'workspace/rules/style.md', '# Style\n\nKeep it short.\n')
  const ts = fake.tickets('acme/web')
  // FakeBackend methods are async but never await, so these complete synchronously.
  void ts.create({ title: 'Add a dark theme to the dashboard', labels: ['bauherr:stage:plan'] })
  void ts.comment('1', PLAN)
  void ts.comment('1', WORKLOG)
  // #2-#5 are placeholders so that later seeded Tickets line up with their forge numbers.
  // They carry an excluded label so the Triage poller leaves them alone.
  const placeholder = (n: number) => ts.create({ title: `Placeholder ${n}`, labels: ['wayfinder:map'] })
  for (const n of [2, 3, 4, 5]) void placeholder(n)
  for (const [n, title] of [[6, 'Ship the CSV export'], [7, 'Ship the invoice filter']] as const) {
    void ts.create({ title, labels: ['bauherr:stage:release'] })
    void ts.comment(String(n), WORKLOG)
    void ts.comment(String(n), summary(n))
  }
  // #8-#13 are placeholders; #14 is held by Triage with its questions.
  for (const n of [8, 9, 10, 11, 12, 13]) void placeholder(n)
  void ts.create({ title: 'Clarify the export scope', labels: ['bauherr:needs-refinement'] })
  void ts.comment('14', QUESTIONS)
  // acme/gated: one Ticket on staging for a Product with a production gate.
  const gated = fake.tickets('acme/gated')
  void gated.create({ title: 'Ship the gated export', labels: ['bauherr:stage:release'] })
  void gated.comment('1', WORKLOG)
  void gated.comment('1', summary(1))
  // #15 sits at the review round cap with its escalation Comment.
  void ts.create({ title: 'Harden the retry loop', labels: ['bauherr:stage:review'] })
  void ts.comment('15', 'Bauherr needs a human: the review found 1 blocking issue(s), after 2 review rounds.\n\n- [medium] src/retry.ts:12 The loop never stops on a permanent error. Scenario: when the gateway answers 402, then the call is retried forever.')
  // #16 on staging, #17 a plan without decisions, #18 a build with a failed Run; gated #2 awaits production approval.
  void ts.create({ title: 'Ship the export header', labels: ['bauherr:stage:release'] })
  void ts.comment('16', WORKLOG)
  void ts.comment('16', summary(16))
  void ts.create({ title: 'Tidy the settings copy', labels: ['bauherr:stage:plan'] })
  void ts.comment('17', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('17', WORKLOG)
  void ts.create({ title: 'Fix the date parser', labels: ['bauherr:stage:build'] })
  void gated.create({ title: 'Ship the gated header', labels: ['bauherr:stage:release', 'bauherr:approved:staging'] })
  void gated.comment('2', WORKLOG)
  void gated.comment('2', summary(2))
  // Knowledge repo of the seeded Workspace: two documents on main and one open write-back PR with red checks.
  const kb = 'acme/knowledge'
  fake.commit(kb, 'main', 'handbook/release-policy.md', '# Release policy\n\nEvery release waits for **staging acceptance**.\n\n## Rollback\n\nRoll back with the previous image tag.\n')
  fake.commit(kb, 'main', 'workspace/rules/naming.md', '# Naming\n\nName branches after the ticket.\n')
  void fake.forge.createBranch(kb, 'bauherr/42')
  const head = fake.commit(kb, 'bauherr/42', 'handbook/lessons.md', '# Lessons\n\nRetries need a stop condition.\n')
  void fake.forge.openPullRequest(kb, { title: 'Write back: lessons from #42', head: 'bauherr/42', base: 'main' })
  fake.setChecks(kb, head, [{ name: 'lint', status: 'completed', conclusion: 'failure' }])
  return fake
}

const g = globalThis as { __bauherrFakeForge?: FakeBackend }
export const fakeForge = (): FakeBackend => {
  if (g.__bauherrFakeForge) return g.__bauherrFakeForge
  const fake = build()
  // Label events are compared with real-time touches; the fake's synthetic clock would never match (tests and e2e alike).
  fake.now = () => new Date().toISOString()
  return (g.__bauherrFakeForge = fake)
}
