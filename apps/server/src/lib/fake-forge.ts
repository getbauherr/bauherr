import { FakeBackend } from '@bauherr/adapters'

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

const CONV = `<!-- bauherr:triage -->
## Questions
Triage needs your answers before this Ticket can be planned.

## Decisions
- **D1 What should it deliver?**. Default: A recurring Docs Agent. Alternatives: A one-off docs audit. Why: A role and a task are planned very differently.
- **D2 What triggers a docs run?**. Default: Manually by the owner. Alternatives: After every merged MR; On a schedule. Why: Decides whether the agent needs a webhook or a timer.
- **D3 Which docs are in scope?**. Default: The published docs. Alternatives: Everything in docs/; README.md only. Why: Sets what the agent reads and may change on each run.
- **D4 How is staleness judged?**. Default: Changed by a merged MR after the page was last edited. Alternatives: Older than 90 days. Why: Decides what the agent compares.
`

const MIXED = `<!-- bauherr:triage -->
## Questions
Triage needs your answers before this Ticket can be planned.

## Decisions
- **D1** Which licence terms apply? Alternatives: Custom terms. Default: Standard terms. Why: Legal risk. critical: true. for: bauherr.
- **D2** What should the header say? Alternatives: Hello again. Default: Welcome back. Why: It is the first thing users read. critical: true.
- **D3** Which icon goes with it? Alternatives: A square one. Default: A round one. critical: false. for: product-owner.
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
  void ts.create({ title: 'Add a dark theme to the dashboard', labels: ['bauherr:stage:plan'] })
  void ts.comment('1', PLAN)
  void ts.comment('1', WORKLOG)
  const placeholder = (n: number) => ts.create({ title: `Placeholder ${n}`, labels: ['wayfinder:map'] })
  for (const n of [2, 3, 4, 5]) void placeholder(n)
  for (const [n, title] of [[6, 'Ship the CSV export'], [7, 'Ship the invoice filter']] as const) {
    void ts.create({ title, labels: ['bauherr:stage:release'] })
    void ts.comment(String(n), WORKLOG)
    void ts.comment(String(n), summary(n))
  }
  for (const n of [8, 9, 10, 11, 12, 13]) void placeholder(n)
  void ts.create({ title: 'Clarify the export scope', labels: ['bauherr:needs-refinement'] })
  void ts.comment('14', QUESTIONS)
  const gated = fake.tickets('acme/gated')
  void gated.create({ title: 'Ship the gated export', labels: ['bauherr:stage:release'] })
  void gated.comment('1', WORKLOG)
  void gated.comment('1', summary(1))
  void fake.tickets('acme/lab-alpha').create({ title: 'Lab Alpha ticket', labels: ['bauherr:stage:build'] })
  void fake.tickets('acme/lab-alpha').comment('1', 'Please check the contrast of the new header.')
  void fake.tickets('acme/lab-beta').create({ title: 'Lab Beta ticket', labels: ['bauherr:stage:build'] })
  for (const [repo, name] of [['acme/who-alpha', 'Alpha'], ['acme/who-beta', 'Beta']] as const) {
    const who = fake.tickets(repo)
    void who.create({ title: `${name}: check the new header on staging`, labels: ['bauherr:stage:release'] })
    void who.comment('1', WORKLOG)
    void who.comment('1', summary(1))
    void who.create({ title: `${name}: approve the retry policy`, labels: ['bauherr:stage:plan'] })
    void who.comment('2', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
    void who.comment('2', WORKLOG)
    void who.create({ title: `${name}: settle the header copy`, labels: ['bauherr:needs-refinement'] })
    void who.comment('3', MIXED)
  }
  fake.commit('newco/shop', 'main', 'README.md', '# Shop\n')
  const shop = fake.tickets('newco/shop')
  void shop.create({ title: 'The invoice total is wrong' })
  void shop.create({ title: 'Add a CSV export' })
  const checks = fake.commit('acme/checks', 'main', 'README.md', '# Checks\n')
  fake.setCommits('acme/checks', [{ sha: checks, message: 'Deploy to production' }])
  fake.setChecks('acme/checks', checks, [{ name: 'deploy-production', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'success' }])
  fake.commit('acme/editor', 'main', 'README.md', '# Editor\n')
  void fake.tickets('acme/editor').create({ title: 'Editor lab: build the thing', labels: ['bauherr:stage:build'] })
  fake.commit('acme/park', 'main', 'README.md', '# Park\n')
  for (const title of ['Parked: needs cloud credentials', 'Working: first', 'Working: second']) void fake.tickets('acme/park').create({ title, labels: ['bauherr:stage:build'] })
  fake.commit('acme/rc-web', 'main', 'README.md', '# Rc Web\n')
  fake.commit('acme/rc-api', 'main', 'README.md', '# Rc Api\n')
  fake.commit('acme/conv', 'main', 'README.md', '# Conv\n')
  const conv = fake.tickets('acme/conv')
  const body = 'A recurring Docs Agent keeps the docs in step.\n\n## Trigger\nTo be decided.\n\n## Acceptance criteria\n- The agent opens a merge request with the doc changes'
  for (const title of ['Docs Agent', 'Export the invoices', 'Name the export file']) void conv.create({ title, body, labels: ['bauherr:needs-refinement', 'bauherr:type:feature'] })
  for (const n of ['1', '2', '3']) void conv.comment(n, CONV)
  fake.commit('acme/merge', 'main', '.github/workflows/ci.yml', 'name: ci\non:\n  pull_request:\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps: []\n')
  fake.setQueueSupport('acme/merge', true)
  fake.setRequiredChecks('acme/merge', ['ci'])
  void ts.create({ title: 'Harden the retry loop', labels: ['bauherr:stage:review'] })
  void ts.comment('15', 'Bauherr needs a human: the review found 1 blocking issue(s), after 2 review rounds.\n\n- [medium] src/retry.ts:12 The loop never stops on a permanent error. Scenario: when the gateway answers 402, then the call is retried forever.')
  void ts.create({ title: 'Ship the export header', labels: ['bauherr:stage:release'] })
  void ts.comment('16', WORKLOG)
  void ts.comment('16', summary(16))
  void ts.create({ title: 'Tidy the settings copy', labels: ['bauherr:stage:plan'] })
  void ts.comment('17', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('17', WORKLOG)
  void ts.create({ title: 'Fix the date parser', labels: ['bauherr:stage:build'] })
  for (const n of [19, 20]) void placeholder(n)
  void ts.comment('20', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.create({ title: 'Remember the theme choice', labels: ['bauherr:stage:plan'] })
  void ts.comment('21', PLAN.replace(/- \*\*D2[^\n]*\n/, ''))
  void ts.comment('21', WORKLOG)
  void ts.create({ title: 'Pick the export columns', labels: ['bauherr:stage:plan'] })
  void ts.comment('22', PLAN)
  void ts.comment('22', WORKLOG)
  void ts.create({ title: 'Settle the export format', labels: ['bauherr:needs-refinement'] })
  void ts.comment('23', QUESTIONS)
  void ts.create({ title: 'Add a light theme to the dashboard', labels: ['bauherr:stage:plan'] })
  void ts.comment('24', PLAN)
  void ts.comment('24', WORKLOG)
  void ts.create({ title: 'Hold the approved export tweak', labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  void ts.comment('25', PLAN)
  void ts.comment('25', WORKLOG)
  void ts.create({ title: 'Approve the retry policy', labels: ['bauherr:stage:plan'] })
  void ts.comment('26', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('26', WORKLOG)
  void ts.create({ title: 'Review the retry policy', labels: ['bauherr:stage:review'] })
  void ts.comment('27', WORKLOG)
  for (const [n, title] of [[28, 'Chat: cache the export totals'], [29, 'Chat: rename the export columns']] as const) {
    void ts.create({ title, labels: ['bauherr:stage:plan'] })
    void ts.comment(String(n), PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
    void ts.comment(String(n), WORKLOG)
  }
  for (const n of [30, 31, 32, 33, 34, 35, 36]) void placeholder(n)
  void ts.create({ title: 'Rename the sign-in button', labels: ['bauherr:stage:plan'] })
  void ts.comment('37', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('37', WORKLOG)
  void ts.create({ title: 'Stop the export retry loop', labels: ['bauherr:stage:review'] })
  void ts.comment('38', WORKLOG)
  void ts.create({ title: 'Check the new header on staging', labels: ['bauherr:stage:release'] })
  void ts.comment('39', WORKLOG)
  void ts.comment('39', summary(39))
  void ts.create({ title: 'Hand over the export notes', labels: ['bauherr:stage:plan'] })
  void ts.comment('40', PLAN.replace(/\n## Decisions[\s\S]*$/, ''))
  void ts.comment('40', WORKLOG)
  void ts.create({ title: 'Name the export file', labels: ['bauherr:needs-refinement'] })
  void ts.comment('41', QUESTIONS.replace('Which export format, critical', 'Which file name').replace('Default: CSV. Alternatives: XLSX; JSON.', 'Default: export.csv. Alternatives: report.csv; data.csv.'))
  void ts.create({ title: 'Switch the dashboard to a light theme', labels: ['bauherr:stage:plan'] })
  void ts.comment('42', PLAN)
  void ts.comment('42', WORKLOG)
  void ts.create({ title: 'Hotfix: fix the export header', labels: ['bauherr:stage:build'] })
  void ts.comment('43', PLAN)
  void ts.comment('43', WORKLOG)
  void ts.create({ title: 'Stuck review: sort the export rows', labels: ['bauherr:stage:review'] })
  void ts.comment('44', WORKLOG)
  void gated.create({ title: 'Ship the gated header', labels: ['bauherr:stage:release', 'bauherr:approved:staging'] })
  void gated.comment('2', WORKLOG)
  void gated.comment('2', summary(2))
  const proof = fake.tickets('acme/proof')
  void proof.create({ title: 'Ship the proof export', labels: ['bauherr:stage:release'] })
  void proof.comment('1', WORKLOG)
  void proof.comment('1', summary(1))
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
  for (const [i, title] of ['Rcline export totals', 'Rcline invoice filter', 'Rcline CSV header'].entries()) {
    void fake.tickets('acme/rcline').create({ title, labels: ['wayfinder:map'] })
    void fake.tickets('acme/rcline').comment(String(i + 1), summary(i + 1))
    fake.setCommitDate('acme/rcline', `acme-rcline-sha-${i + 1}`, `2026-11-0${i + 1}T10:00:00Z`)
  }
  fake.setAncestors('acme/rcline', 'acme-rcline-sha-2', ['acme-rcline-sha-1', 'acme-rcline-sha-0'])
  fake.addRelease('acme/rcline', { tag: 'v0.3.0', sha: 'acme-rcline-sha-0', createdAt: '2026-10-01T10:00:00Z' })
  fake.addRelease('acme/rcline', { tag: 'v0.4.0-rc.1', sha: 'acme-rcline-sha-2', prerelease: true, createdAt: '2026-11-02T10:00:00Z', body: 'Release candidate' })
  fake.commit('acme/rcline', 'main', 'CHANGELOG.md', '# Changelog\n\n## Unreleased\n')
  const kb = 'acme/knowledge'
  fake.commit(kb, 'main', 'handbook/release-policy.md', '# Release policy\n\nEvery release waits for **staging acceptance**.\n\n## Rollback\n\nRoll back with the previous image tag.\n')
  fake.commit(kb, 'main', 'workspace/rules/naming.md', '# Naming\n\nName branches after the ticket.\n')
  fake.commit('acme/web', 'main', 'docs/architecture.md', '# Architecture\n\nThe dashboard renders invoices.\n')
  void fake.forge.createBranch(kb, 'bauherr/42')
  const head = fake.commit(kb, 'bauherr/42', 'handbook/lessons.md', '# Lessons\n\nRetries need a stop condition.\n')
  void fake.forge.openPullRequest(kb, { title: 'Write back: lessons from #42', head: 'bauherr/42', base: 'main' })
  fake.setChecks(kb, head, [{ name: 'lint', status: 'completed', conclusion: 'failure' }])
  void fake.forge.createBranch(kb, 'bauherr/9001')
  fake.commit(kb, 'bauherr/9001', 'workspace/skills/tdd-first/SKILL.md', '---\nname: tdd-first\ndescription: Write the failing test first.\n---\nWrite a failing test before the fix.\n')
  void fake.forge.openPullRequest(kb, { title: 'Skill proposal: tdd-first (from #127)', head: 'bauherr/9001', base: 'main' })
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
  fake.now = () => new Date().toISOString()
  return (g.__bauherrFakeForge = fake)
}
