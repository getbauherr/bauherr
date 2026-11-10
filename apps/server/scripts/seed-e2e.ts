import { readFileSync } from 'node:fs'
import { getPayload } from 'payload'
import { hasProductionChecks } from '../src/lib/mode'
import { needsOf } from '../src/lib/needs-you'
import { DEFAULT, kindOf } from '../src/lib/workflow'
import config from '../src/payload.config'

/** Seeds what the Playwright smoke needs on an empty DB: one admin, one Workspace, one Product, one Ticket. Idempotent. */
const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}
const payload = await getPayload({ config })
const o = { overrideAccess: true } as const
const ensure = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({ collection, where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, { equals: v }])) as never, limit: 1, depth: 0, ...o })
  return found.docs[0] ?? (await payload.create({ collection, data: data as never, ...o }))
}

const email = env('E2E_EMAIL')
const admin = (await ensure('bauherren', { email }, { email, password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: 'e2e-admin' })).id
// A sign-out bumps the user's sessionVersion and ends every session of that user, so a spec that signs out signs in as a user of its own.
for (const [who, login] of [['signout-shell', 'e2e-signout-shell'], ['signout-requests', 'e2e-signout-requests'], ['signout-flow', 'e2e-signout-flow']]) await ensure('bauherren', { email: `${who}@example.com` }, { email: `${who}@example.com`, password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: login })
// one admin per Playwright worker (e2e/user.ts): concurrent logins of one user can lose each other's session
const workerAdmins = [admin]
for (const w of [1, 2]) workerAdmins.push((await ensure('bauherren', { email: email.replace('@', `-w${w}@`) }, { email: email.replace('@', `-w${w}@`), password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: `e2e-admin-w${w}` })).id)
const draftOwner = (await ensure('bauherren', { email: 'draft-owner@example.com' }, { email: 'draft-owner@example.com', password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: 'e2e-draft-owner' })).id // owns the seeded Draft; only requests.spec signs in as this user, and its tests run in one worker
const workspace = (await ensure('workspaces', { slug: 'acme' }, { name: 'Acme', slug: 'acme', wipLimits: {} })).id
await ensure('bauherren', { email: 'member@example.com' }, { email: 'member@example.com', password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'bauherr', tenants: [{ tenant: workspace }] })
const zeta = (await ensure('workspaces', { slug: 'zeta' }, { name: 'Zeta', slug: 'zeta' })).id
const password = readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim()
await ensure('bauherren', { email: 'solo@example.com' }, { email: 'solo@example.com', password, role: 'bauherr', tenants: [{ tenant: zeta }] })
await ensure('bauherren', { email: 'duo@example.com' }, { email: 'duo@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }, { tenant: zeta }] })
await ensure('products', { slug: 'zeta-app' }, { name: 'Zeta App', slug: 'zeta-app', workspace: zeta }) // the one Product of a single-Product Workspace
const newco = (await ensure('workspaces', { slug: 'newco' }, { name: 'Newco', slug: 'newco' })).id // stays empty: /setup walks it
await ensure('bauherren', { email: 'setup-member@example.com' }, { email: 'setup-member@example.com', password, role: 'bauherr', tenants: [{ tenant: newco }] })
const product = (await ensure('products', { slug: 'acme-web' }, { name: 'Acme Web', slug: 'acme-web', workspace, stagingUrl: 'https://staging.example.com' })).id
const shop = (await ensure('products', { slug: 'acme-shop' }, { name: 'Acme Shop', slug: 'acme-shop', workspace })).id
const github = (await ensure('connections', { name: 'GitHub Acme' }, { name: 'GitHub Acme', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace })).id
await payload.update({ collection: 'workspaces', id: workspace, data: { knowledgeConnection: github, knowledgeRepo: 'acme/knowledge' }, ...o })
await ensure('repositories', { fullName: 'acme/web' }, { fullName: 'acme/web', product, workspace })
await ensure('ticket_sources', { repo: 'acme/web' }, { repo: 'acme/web', product, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
const seeded = new Set<number>()
const ticket = async (n: number, title: string, stage: string, p: string | number, extra: Record<string, unknown> = {}) => {
  if (seeded.has(n)) throw new Error(`seed-e2e: Ticket number ${n} seeded twice`)
  seeded.add(n)
  return (await ensure('tickets', { externalId: `e2e-${n}` }, {
    title, externalId: `e2e-${n}`, number: n, url: `https://github.com/acme/web/issues/${n}`,
    state: 'open', labels: [`bauherr:stage:${stage}`], stage, product: p, workspace, rank: String(n).padStart(6, '0'), ...extra,
  })).id
}
const run = async (t: string | number, stage: string, status: string, extra: Record<string, unknown> = {}) =>
  ensure('runs', { ticket: t, stage, status }, { ticket: t, stage, status, mode: 'autonomous', workspace, ...extra })

// `openCriticalDecisions` mirrors what plan submission stores for the fake forge's full PLAN (one critical decision, D2).
const openCritical = { openCriticalDecisions: 1 }
const t1 = await ticket(1, 'Add a dark theme to the dashboard', 'plan', product, openCritical)
const t2 = await ticket(2, 'Export invoices as CSV', 'build', product)
const t3 = await ticket(3, 'Checkout fails for empty carts', 'build', shop)
await ticket(4, 'Triage the onboarding feedback', 'triage', shop)
const t5 = await ticket(5, 'Upgrade the payment SDK', 'review', shop)
const rel = { stage: 'release', releaseState: 'on_staging', mergeSha: 'abc1234def' }
await ticket(6, 'Ship the CSV export', 'release', product, rel)
await ticket(7, 'Ship the invoice filter', 'release', product, rel)
const blocker = await ticket(8, 'Blocker: migrate the invoice table', 'build', product)
const blocked = await ticket(9, 'Blocked: add the invoice filter', 'build', product, { blockedBy: [blocker] })
await ticket(10, 'Document the invoice filter', 'plan', product, { blockedBy: [blocked] })
const parentTicket = await ticket(11, 'Overhaul invoicing', 'parent', product)
await ticket(12, 'Invoice PDF layout', 'build', product, { parent: parentTicket, inheritedApprovalFrom: parentTicket })
await ticket(13, 'Invoice numbering', 'build', product, { parent: parentTicket, inheritedApprovalFrom: parentTicket, state: 'closed' })
const epic2 = await ticket(31, 'Revamp onboarding', 'parent', product)
await ticket(32, 'Welcome email copy', 'plan', product, { parent: epic2, inheritedApprovalFrom: epic2 })
await ticket(33, 'Signup form validation', 'build', product, { parent: epic2, inheritedApprovalFrom: epic2 })
await ticket(34, 'Signup analytics', 'build', product, { parent: epic2, inheritedApprovalFrom: epic2, state: 'closed' })
const epic3 = await ticket(35, 'Retire the legacy importer', 'done', product, { state: 'closed' })
await ticket(36, 'Remove importer cron', 'build', product, { parent: epic3, inheritedApprovalFrom: epic3, state: 'closed' })
await ticket(14, 'Clarify the export scope', 'triage', product, { stage: null, labels: ['bauherr:needs-refinement'] })
await ticket(17, 'Awaiting close', 'done', product)
await ticket(18, 'Awaiting archive', 'done', product)
const gated = (await ensure('products', { slug: 'acme-gated' }, { name: 'Acme Gated', slug: 'acme-gated', workspace, productionGate: true, productionChecks: 'deploy-prod' })).id
await ensure('repositories', { fullName: 'acme/gated' }, { fullName: 'acme/gated', product: gated, workspace })
await ensure('ticket_sources', { repo: 'acme/gated' }, { repo: 'acme/gated', product: gated, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
await ensure('tickets', { externalId: 'e2e-gated-1' }, { title: 'Ship the gated export', externalId: 'e2e-gated-1', number: 1, url: 'https://github.com/acme/gated/issues/1', state: 'open', labels: ['bauherr:stage:release'], ...rel, product: gated, workspace, rank: '000016' })
const checksProduct = (await ensure('products', { slug: 'acme-checks' }, { name: 'Acme Checks', slug: 'acme-checks', workspace })).id
await ensure('repositories', { fullName: 'acme/checks' }, { fullName: 'acme/checks', product: checksProduct, workspace })
await ensure('ticket_sources', { repo: 'acme/checks' }, { repo: 'acme/checks', product: checksProduct, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
const mergeProduct = (await ensure('products', { slug: 'acme-merge' }, { name: 'Acme Merge', slug: 'acme-merge', workspace })).id
await ensure('repositories', { fullName: 'acme/merge' }, { fullName: 'acme/merge', product: mergeProduct, workspace })
await ensure('ticket_sources', { repo: 'acme/merge' }, { repo: 'acme/merge', product: mergeProduct, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
await ticket(15, 'Harden the retry loop', 'review', product, { reviewState: 'needs_human', reviewRounds: 3 })
await ticket(16, 'Ship the export header', 'release', product, rel)
const t17 = await ticket(19, 'Tidy the settings copy', 'plan', product)
const t18 = await ticket(20, 'Fix the date parser', 'build', product)
await ensure('tickets', { externalId: 'e2e-gated-2' }, { title: 'Ship the gated header', externalId: 'e2e-gated-2', number: 2, url: 'https://github.com/acme/gated/issues/2', state: 'open', labels: ['bauherr:stage:release', 'bauherr:approved:staging'], ...rel, productionState: 'awaiting_approval', product: gated, workspace, rank: '000017' })
for (let n = 101; n <= 122; n++) await ticket(n, `Isolated chore ${n}`, n <= 103 ? 'release' : n <= 106 ? 'review' : n <= 112 ? 'build' : n <= 115 ? 'plan' : n <= 118 ? 'triage' : 'done', product)
const t21 = await ticket(21, 'Remember the theme choice', 'plan', product)
const t22 = await ticket(22, 'Pick the export columns', 'plan', product, openCritical)
// Own Tickets of triage.spec.ts (#23, held by Triage with questions) and of the plan-approval test in ticket.spec.ts (#24, approved there). The numbers follow the fake forge (`src/lib/fake-forge.ts`), which creates them in this order.
await ticket(23, 'Settle the export format', 'triage', product, { stage: null, labels: ['bauherr:needs-refinement'] })
const t24 = await ticket(24, 'Add a light theme to the dashboard', 'plan', product, openCritical)
// Own Tickets of the next-step button cases in ticket.spec.ts (#385): #25 an approved plan held by an overlap, #26 a plan awaiting approval, #27 a Build with a live Run. Twins in `src/lib/fake-forge.ts` carry these numbers.
await ticket(25, 'Hold the approved export tweak', 'plan', product, { labels: ['bauherr:stage:plan', 'bauherr:approved:plan'], waitingFor: 'build', waitingReason: 'overlaps #356' })
const t26 = await ticket(26, 'Approve the retry policy', 'plan', product)
const t27 = await ticket(27, 'Review the retry policy', 'review', product)
await run(t26, 'plan', 'succeeded', { startedAt: '2026-10-30T09:40:00Z', finishedAt: '2026-10-30T09:42:00Z' })
// chat-dock.spec.ts: two plans of its own awaiting approval (#28 is approved in the chat, #29 declined; twins in `src/lib/fake-forge.ts`) and a second member who must not see the first one's threads.
for (const [n, title] of [[28, 'Chat: cache the export totals'], [29, 'Chat: rename the export columns']] as const) await run(await ticket(n, title, 'plan', product), 'plan', 'succeeded', { startedAt: '2026-10-30T09:50:00Z', finishedAt: '2026-10-30T09:52:00Z' })
await ensure('bauherren', { email: 'chat-other@example.com' }, { email: 'chat-other@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }] })
await ensure('runs', { ticket: t27, stage: 'review', status: 'running' }, { ticket: t27, stage: 'review', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
// Hotfix (#373): a card in the Hotfix lane of Build, and a merged one 12 minutes after its flag for the lead time in Factory health.
await ticket(125, 'Hotfix: checkout crash', 'build', product, { expedite: true, expediteAt: '2026-11-05T08:00:00Z', rank: '999999' })
await ticket(126, 'Hotfix: login loop', 'done', product, { state: 'closed', expedite: true, expediteAt: '2026-11-05T08:00:00Z', releaseAt: '2026-11-05T08:12:00Z' })
await ticket(124, 'Waiting for a Build slot', 'plan', product, { waitingFor: 'build', rank: '000000' })
const live = await ticket(123, 'Live build in progress', 'build', product, { rank: '900000' })
const distilled = await ticket(127, 'Fix the flaky export test', 'done', product, { state: 'closed' })
await ensure('skill_proposals', { ticket: distilled }, { ticket: distilled, workspace, status: 'replayed', pr: 2, skillPath: 'workspace/skills/tdd-first/SKILL.md', score: 1, baselineScore: 0.5 })
await ensure('runs', { ticket: live, stage: 'build', status: 'running' }, { ticket: live, stage: 'build', status: 'running', mode: 'autonomous', executor: 'runner', model: 'claude-sonnet-4-5', provider: 'anthropic', workspace, startedAt: new Date().toISOString() })
await run(t17, 'plan', 'succeeded', { startedAt: '2026-10-30T12:00:00Z', finishedAt: '2026-10-30T12:01:00Z' })
await run(t18, 'plan', 'succeeded', { startedAt: '2026-10-30T12:05:00Z', finishedAt: '2026-10-30T12:06:00Z' })
await run(t18, 'build', 'failed', { reasonKind: 'decision', startedAt: '2026-10-30T12:10:00Z', finishedAt: '2026-10-30T12:12:00Z' })
await run(t24, 'plan', 'succeeded', { startedAt: '2026-10-30T09:30:00Z', finishedAt: '2026-10-30T09:32:00Z' })
// The owner-chat spec's Tickets have a plan Run in progress from the start ("the plan is being written" is what its answers lead to), so the spec does not depend on how long the server has been up for the factory to start one.
await ensure('runs', { ticket: t21, stage: 'plan', status: 'running' }, { ticket: t21, stage: 'plan', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
await ensure('runs', { ticket: t22, stage: 'plan', status: 'running' }, { ticket: t22, stage: 'plan', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
await run(t1, 'plan', 'succeeded', { startedAt: '2026-10-30T09:00:00Z', finishedAt: '2026-10-30T09:02:30Z', costUsd: 0.1234 })
const build = await run(t2, 'build', 'succeeded', { startedAt: '2026-10-30T09:10:00Z', finishedAt: '2026-10-30T09:25:12Z', gatewayCostUsd: 1.5, model: 'claude-sonnet-4-5', provider: 'anthropic', executor: 'session', mode: 'session', sessionLabel: 'e2e-laptop', clientName: 'claude-code', clientVersion: '2.1.0', outcome: 'done', tokensIn: 12000, tokensOut: 3400, tokensCache: 8000, evidence: 'Checks: pass', artifacts: { prUrl: 'https://github.com/acme/web/pull/12' } })
const steps = [['09:10:05', 'Read the plan and the repo'], ['09:14:00', 'Implement the CSV export'], ['09:21:30', 'Run the checks']] as const
for (const [i, [at, summary]] of steps.entries()) {
  const step = await ensure('steps', { run: build.id, seq: i + 1 }, { run: build.id, seq: i + 1, summary, startedAt: `2026-10-30T${at}Z`, tokensIn: 4000, tokensOut: 1100, workspace })
  if (i > 0) await ensure('tool_calls', { toolUseId: `e2e-tool-${i}` }, { toolUseId: `e2e-tool-${i}`, step: step.id, run: build.id, name: i === 1 ? 'Edit' : 'run_checks', inputDigest: '{"path":"src/export.ts"}', status: 'ok', durationMs: i === 1 ? 90000 : 120000, workspace })
}
for (const [checkName, sha] of [['e2e', 'sha-a'], ['e2e', 'sha-b'], ['lint', 'sha-a']] as const) await ensure('check_flakes', { ticket: t2, sha, checkName }, { ticket: t2, sha, checkName, outcome: 'flake', workspace })
await ensure('human_touches', { kind: 'approve:plan', ticket: t2 }, { kind: 'approve:plan', ticket: t2, actor: email, at: '2026-10-30T09:05:00Z', workspace })
// Ticket history (`ticket_events`) for the Workflow view, the Ticket page's path and Insights: `[stage, phase, hours ago, extra]`, written directly (relative to the seeding time, keyed by `e2e:<number>:<index>`).
const wfSeed = DEFAULT()
const seedNow = Date.now()
type Step = [stage: string, phase: string, hoursAgo: number, extra?: Record<string, unknown>]
const history = async (number: number, steps: Step[]) => {
  const t = (await payload.find({ collection: 'tickets', where: { externalId: { equals: `e2e-${number}` } }, limit: 1, depth: 0, ...o })).docs[0] as { id: number }
  for (const [i, [stage, phase, hours, extra]] of steps.entries()) {
    const cause = `e2e:${number}:${i}`
    const executor = phase === 'working' ? 'runner' : phase === 'human' ? 'human' : phase === 'ci' ? 'ci' : 'factory'
    await ensure('ticket_events', { ticket: t.id, cause }, { ticket: t.id, workspace, at: new Date(seedNow - hours * 3600e3).toISOString(), stage, stageKind: kindOf(wfSeed, stage), phase, fromStage: steps[i - 1]?.[0] ?? null, executor, cause, ...extra })
  }
  const last = steps[steps.length - 1]!
  await payload.update({ collection: 'tickets', id: t.id, data: { historyKey: `${last[0]}|${last[1]}` }, ...o })
}
const approve = { cause: 'gate:approve:plan', actor: email }
const full = (done: number, k: number): Step[] => {
  const d = [0.3, 0.1, 0.5, 0.4, 6, 20, 3, 1, 0.5, 0.4, 0.3, 12].map((h) => h * k)
  const rows: [string, string, Record<string, unknown>?][] = [['triage', 'queued'], ['triage', 'working'], ['plan', 'queued'], ['plan', 'working'], ['plan', 'human'], ['build', 'queued', approve], ['build', 'working'], ['review', 'queued'], ['review', 'working'], ['review', 'ci'], ['release', 'ci'], ['release', 'human'], ['done', 'closed', { cause: 'gate:approve:production', actor: email }]]
  let at = done + d.reduce((a, b) => a + b, 0)
  return rows.map(([stage, phase, extra], i): Step => { const step: Step = [stage, phase, at, extra]; at -= d[i] ?? 0; return step })
}
for (const [n, done, k] of [[126, 40, 0.7], [127, 20, 0.6], [36, 70, 1], [34, 216, 1.3], [13, 480, 0.8]] as const) await history(n, full(done, k))
await history(2, [['triage', 'queued', 30], ['triage', 'working', 29.8], ['plan', 'queued', 29.5], ['plan', 'working', 29.3], ['plan', 'human', 29], ['build', 'queued', 28.5, approve], ['build', 'working', 28.2, { run: build.id, executor: 'session', actor: 'e2e-laptop', cause: 'run:claimed' }], ['build', 'queued', 27.9, { cause: 'run:finished' }]])
await history(5, [['triage', 'queued', 50], ['triage', 'working', 49.8], ['plan', 'queued', 49.5], ['plan', 'working', 49.3], ['build', 'queued', 48], ['build', 'working', 47], ['review', 'queued', 45], ['review', 'working', 44.5], ['build', 'queued', 44, { outcome: 'changes', cause: 'moveStage:request_changes' }], ['build', 'working', 43], ['review', 'queued', 41, { outcome: 'done' }], ['review', 'working', 40.5], ['review', 'queued', 40.2]])
const widgetOnly = (await ensure('products', { slug: 'acme-widget' }, { name: 'Acme Widget', slug: 'acme-widget', workspace })).id
await ensure('embed_tokens', { name: 'Widget only' }, { name: 'Widget only', product: widgetOnly, tokenHash: 'e2e-widget-only-hash', workspace })
await ensure('workflow_versions', { product }, { version: 1, product, compiled: { stages: [{ name: 'plan' }] }, workspace })
await run(t3, 'build', 'needs_human', { startedAt: '2026-10-30T10:00:00Z' })
// run.spec.ts re-runs this Run: it lives on Acme Checks, which no other spec counts Runs of (overview.spec.ts counts those of Acme Web and Acme Shop).
const stalled = (await ensure('tickets', { externalId: 'e2e-checks-1' }, { title: 'Recover the stalled import', externalId: 'e2e-checks-1', number: 1, url: 'https://github.com/acme/checks/issues/1', state: 'open', labels: ['bauherr:stage:build'], stage: 'build', product: checksProduct, workspace, rank: '000025' })).id
await run(stalled, 'build', 'needs_human', { startedAt: '2026-10-30T10:30:00Z' })
// Own Ticket of the release-failed case in ticket.spec.ts (#2 on Acme Checks): release checks failed with no run link, so the next-step bar falls back to the details link.
await ensure('tickets', { externalId: 'e2e-checks-2' }, { title: 'Release the CSV checks', externalId: 'e2e-checks-2', number: 2, url: 'https://github.com/acme/checks/issues/2', state: 'open', labels: ['bauherr:stage:release'], stage: 'release', releaseChecksState: 'failed', product: checksProduct, workspace, rank: '000026' })
await run(t5, 'review', 'succeeded', {
  startedAt: '2026-10-30T11:00:00Z', finishedAt: '2026-10-30T11:04:00Z', verdict: 'changes',
  findings: [
    { severity: 'medium', file: 'src/payment.ts', line: 42, msg: 'The retry loop never stops on a permanent error.', scenario: 'when the gateway answers 402, then the call is retried forever instead of failing.' },
    { severity: 'low', file: 'src/payment.ts', line: 7, msg: 'Unused import.', scenario: 'lint noise only.' },
  ],
})
// releases.spec.ts: two manual Products of their own, each with done Tickets waiting for a release. Acme Relist is only listed (its releaseAt is old, so the Board reminds), Acme Reship is shipped. Twins in `src/lib/fake-forge.ts` carry these numbers.
for (const [slug, name, repo, titles, releaseAt] of [
  ['acme-relist', 'Acme Relist', 'acme/relist', ['Relist the export totals', 'Relist the invoice filter', 'Relist the CSV header'], '2026-10-01T09:00:00Z'],
  ['acme-reship', 'Acme Reship', 'acme/reship', ['Reship the export totals', 'Reship the invoice filter'], undefined],
] as const) {
  const p = (await ensure('products', { slug }, { name, slug, workspace, releaseMode: 'manual', releaseReminderDays: 7 })).id
  await ensure('repositories', { fullName: repo }, { fullName: repo, product: p, workspace })
  await ensure('ticket_sources', { repo }, { repo, product: p, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
  // Done before releases were shipped from the page (release recorded by the other path): never waiting.
  if (slug === 'acme-relist') await ensure('tickets', { externalId: `e2e-${slug}-old` }, { title: 'Relist the earlier release', externalId: `e2e-${slug}-old`, number: 9, url: `https://github.com/${repo}/issues/9`, state: 'closed', labels: [], stage: 'done', mergeSha: `${slug}-sha-old`, releasePublishedAt: '2026-09-01T09:00:00Z', releaseAt: '2026-09-01T09:00:00Z', product: p, workspace, rank: '000199' })
  for (const [i, title] of titles.entries()) await ensure('tickets', { externalId: `e2e-${slug}-${i + 1}` }, { title, externalId: `e2e-${slug}-${i + 1}`, number: i + 1, url: `https://github.com/${repo}/issues/${i + 1}`, state: 'closed', labels: i === 0 ? ['type:feature'] : [], stage: 'done', mergeSha: `${slug}-sha-${i + 1}`, releaseAt, product: p, workspace, rank: String(200 + i).padStart(6, '0') })
}
const request = async (key: string, status: string, extra: Record<string, unknown>) =>
  ensure('intake_sessions', { 'draft.problem': key }, { product, workspace, status, persona: 'product-user', messages: [], draft: { problem: key, context: '', acceptance_criteria: [], type: 'bug', links: [] }, ...extra })
await request('Export totals drift', 'open', { user: draftOwner })
await request('Dark theme for the dashboard', 'submitted', { ticketNumber: 1 })
await request('Invoice filter and CSV export', 'submitted', { ticketNumber: 6, ticketNumbers: [6, 7] })
// No sweeper runs in e2e: fill `tickets.needsYou` (the top bar's count) the way the gate sweep does.
for (const t of (await payload.find({ collection: 'tickets', pagination: false, depth: 0, ...o })).docs as Record<string, any>[]) {
  const latest = (await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, sort: '-createdAt', limit: 1, depth: 0, ...o })).docs[0] as unknown as { stage: string; status: string; reasonKind?: string | null } | undefined
  const productDoc = (await payload.findByID({ collection: 'products', id: t.product, depth: 0, ...o })) as Record<string, any>
  const need = needsOf(t, latest ?? null, !hasProductionChecks(productDoc))
  if (need !== (t.needsYou ?? null)) await payload.update({ collection: 'tickets', id: t.id, data: { needsYou: need }, ...o })
}
console.log('seeded')
process.exit(0)
