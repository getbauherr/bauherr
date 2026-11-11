import { FakeBackend } from '@bauherr/adapters'

/** E2E only (`BAUHERR_E2E_FAKE_FORGE=1`): in-memory forge holding the seeded Ticket #1 of `acme/web` with a plan and a worklog, and the Knowledge repo `acme/knowledge`. */
const PLAN = `<!-- bauherr:plan -->
# Plan: dark theme for the dashboard

## TL;DR
Decision: Approve the dark theme plan
Recommendation: Approve; it only adds colour tokens and a toggle.
Why:
- Two small steps
- No data is touched
Risk: none

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
  // newco/shop: the repository and open issues the setup wizard's e2e picks on the Workspace `newco`.
  fake.commit('newco/shop', 'main', 'README.md', '# Shop\n')
  const shop = fake.tickets('newco/shop')
  void shop.create({ title: 'The invoice total is wrong' })
  void shop.create({ title: 'Add a CSV export' })
  // acme/checks: a Product whose production deploy check `deploy-production` shows up in the Settings check picker.
  const checks = fake.commit('acme/checks', 'main', 'README.md', '# Checks\n')
  fake.setCommits('acme/checks', [{ sha: checks, message: 'Deploy to production' }])
  fake.setChecks('acme/checks', checks, [{ name: 'deploy-production', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'success' }])
  // acme/merge: a merge queue is on, but the only workflow has no merge_group trigger; the merge-mode spec re-detects it.
  fake.commit('acme/merge', 'main', '.github/workflows/ci.yml', 'name: ci\non:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps: []\n')
  fake.setQueueSupport('acme/merge', true)
  fake.setRequiredChecks('acme/merge', ['ci'])
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
  // #21 is the owner-chat spec's own Ticket: one open decision, so it needs no other spec's answers.
  for (const n of [19, 20]) void placeholder(n)
  // The seeded "Fix the date parser" is Ticket number 20 here: its plan Comment is what the stage-history spec reads.
  void ts.comment('20', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.create({ title: 'Remember the theme choice', labels: ['bauherr:stage:plan'] })
  void ts.comment('21', PLAN.replace(/- \*\*D2[^\n]*\n/, ''))
  void ts.comment('21', WORKLOG)
  // #22 is the owner-chat spec's second Ticket: two open decisions (D2 critical, asked first).
  void ts.create({ title: 'Pick the export columns', labels: ['bauherr:stage:plan'] })
  void ts.comment('22', PLAN)
  void ts.comment('22', WORKLOG)
  // #23 is the triage spec's own Ticket (held by Triage with questions), #24 the plan-approval test's own Ticket (two open decisions).
  void ts.create({ title: 'Settle the export format', labels: ['bauherr:needs-refinement'] })
  void ts.comment('23', QUESTIONS)
  void ts.create({ title: 'Add a light theme to the dashboard', labels: ['bauherr:stage:plan'] })
  void ts.comment('24', PLAN)
  void ts.comment('24', WORKLOG)
  // #25-#27 are the next-step button cases of ticket.spec.ts: an approved plan held by an overlap, a plan awaiting approval, a Build with a live Run.
  void ts.create({ title: 'Hold the approved export tweak', labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  void ts.comment('25', PLAN)
  void ts.comment('25', WORKLOG)
  void ts.create({ title: 'Approve the retry policy', labels: ['bauherr:stage:plan'] })
  void ts.comment('26', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('26', WORKLOG)
  void ts.create({ title: 'Review the retry policy', labels: ['bauherr:stage:review'] })
  void ts.comment('27', WORKLOG)
  // #28 and #29 are the chat-dock spec's own plans awaiting approval (one approved, one declined).
  for (const [n, title] of [[28, 'Chat: cache the export totals'], [29, 'Chat: rename the export columns']] as const) {
    void ts.create({ title, labels: ['bauherr:stage:plan'] })
    void ts.comment(String(n), PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
    void ts.comment(String(n), WORKLOG)
  }
  // #30-#36 are placeholders (the DB-only Tickets of the seed carry these numbers).
  for (const n of [30, 31, 32, 33, 34, 35, 36]) void placeholder(n)
  // #37-#39 are inbox.spec.ts's own Tickets: a plan to approve, a review at its round cap, a change on staging.
  void ts.create({ title: 'Rename the sign-in button', labels: ['bauherr:stage:plan'] })
  void ts.comment('37', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('37', WORKLOG)
  void ts.create({ title: 'Stop the export retry loop', labels: ['bauherr:stage:review'] })
  void ts.comment('38', WORKLOG)
  void ts.create({ title: 'Check the new header on staging', labels: ['bauherr:stage:release'] })
  void ts.comment('39', WORKLOG)
  void ts.comment('39', summary(39))
  // #40 is the plan inbox.spec.ts approves from the chat.
  void ts.create({ title: 'Hand over the export notes', labels: ['bauherr:stage:plan'] })
  void ts.comment('40', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('40', WORKLOG)
  void gated.create({ title: 'Ship the gated header', labels: ['bauherr:stage:release', 'bauherr:approved:staging'] })
  void gated.comment('2', WORKLOG)
  void gated.comment('2', summary(2))
  // releases.spec.ts: done Tickets (#1..) of two manual Products, merged as `<slug>-sha-<n>` in order, so the newest merge contains the others.
  for (const [repo, slug, titles] of [['acme/relist', 'acme-relist', ['Relist the export totals', 'Relist the invoice filter', 'Relist the CSV header']], ['acme/reship', 'acme-reship', ['Reship the export totals', 'Reship the invoice filter']]] as const) {
    const t = fake.tickets(repo)
    for (const [i, title] of titles.entries()) {
      void t.create({ title, labels: ['wayfinder:map'] })
      void t.comment(String(i + 1), summary(i + 1))
      fake.setCommitDate(repo, `${slug}-sha-${i + 1}`, `2026-11-0${i + 1}T10:00:00Z`)
    }
    fake.setAncestors(repo, `${slug}-sha-${titles.length}`, titles.map((_, i) => `${slug}-sha-${i + 1}`))
  }
  fake.commit('acme/reship', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  // Knowledge repo of the seeded Workspace: two documents on main and one open write-back PR with red checks.
  const kb = 'acme/knowledge'
  fake.commit(kb, 'main', 'handbook/release-policy.md', '# Release policy\n\nEvery release waits for **staging acceptance**.\n\n## Rollback\n\nRoll back with the previous image tag.\n')
  fake.commit(kb, 'main', 'workspace/rules/naming.md', '# Naming\n\nName branches after the ticket.\n')
  fake.commit('acme/web', 'main', 'docs/architecture.md', '# Architecture\n\nThe dashboard renders invoices.\n')
  void fake.forge.createBranch(kb, 'bauherr/42')
  const head = fake.commit(kb, 'bauherr/42', 'handbook/lessons.md', '# Lessons\n\nRetries need a stop condition.\n')
  void fake.forge.openPullRequest(kb, { title: 'Write back: lessons from #42', head: 'bauherr/42', base: 'main' })
  fake.setChecks(kb, head, [{ name: 'lint', status: 'completed', conclusion: 'failure' }])
  // A distilled skill proposal (seed-e2e: skill_proposals row with pr 2) waiting for its owner approval.
  void fake.forge.createBranch(kb, 'bauherr/9001')
  fake.commit(kb, 'bauherr/9001', 'workspace/skills/tdd-first/SKILL.md', '---\nname: tdd-first\ndescription: Write the failing test first.\n---\nWrite a failing test before the fix.\n')
  void fake.forge.openPullRequest(kb, { title: 'Skill proposal: tdd-first (from #127)', head: 'bauherr/9001', base: 'main' })
  // Further skill proposals (seed-e2e: PRs 3 to 5 of 128, 130 and 131) for the reject and Inbox cases.
  for (const [n, name] of [[3, 'report-caching'], [4, 'retry-limits'], [5, 'naming']] as const) {
    void fake.forge.createBranch(kb, `bauherr/900${n}`)
    fake.commit(kb, `bauherr/900${n}`, `workspace/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name}.\n---\nFollow ${name}.\n`)
    void fake.forge.openPullRequest(kb, { title: `Skill proposal: ${name}`, head: `bauherr/900${n}`, base: 'main' })
  }
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
