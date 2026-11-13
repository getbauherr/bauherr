import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { getPayload } from 'payload'
import { parseDocument, stringify } from 'yaml'
import { hasProductionChecks } from '../src/lib/mode'
import { applyFactory, inlineProfiles, workflowFor } from '../src/lib/factory'
import { attachProof } from '../src/lib/artifacts'
import { prepareDecision } from '../src/lib/decision'
import { needsOf } from '../src/lib/needs-you'
import { askedOf, needBy } from '../src/lib/addressee'
import { productOwnersOfTicket } from '../src/lib/people'
import { productGates } from '../src/lib/staging'
import { corePack, kindOf } from '../src/lib/workflow'
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
await ensure('bauherren', { email: 'guard-bauherr@example.com' }, { email: 'guard-bauherr@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }] }) // the signed-in control of product-owner.spec: only that spec signs in as this user
await ensure('bauherren', { email: 'monitoring-bauherr@example.com' }, { email: 'monitoring-bauherr@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }] }) // the non-Admin control of monitoring.spec: only that spec signs in as this user
await ensure('bauherren', { email: 'owner@example.com' }, { email: 'owner@example.com', password, role: 'product-owner', assignments: [{ workspace, scope: 'products', products: [product] }] }) // the Product owner of Acme Web; people.spec and product-owner.spec sign in as this user
const github = (await ensure('connections', { name: 'GitHub Acme' }, { name: 'GitHub Acme', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace })).id
// settings.spec.ts and templates.spec.ts own this Workspace (signed in with the `bauherr-ws=settingsco` cookie): they save its budget, models, Knowledge and templates and add a Connection, which no spec reading `acme` may see.
const settingsco = (await ensure('workspaces', { slug: 'settingsco' }, { name: 'Settingsco', slug: 'settingsco' })).id
const settingsGithub = (await ensure('connections', { name: 'GitHub Settingsco' }, { name: 'GitHub Settingsco', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: settingsco })).id
const settingsApp = (await ensure('products', { slug: 'settingsco-app' }, { name: 'Settings App', slug: 'settingsco-app', workspace: settingsco, stagingUrl: 'https://staging.example.com' })).id
await ensure('repositories', { fullName: 'settingsco/app' }, { fullName: 'settingsco/app', product: settingsApp, workspace: settingsco })
await payload.update({ collection: 'workspaces', id: settingsco, data: { knowledgeConnection: settingsGithub, knowledgeRepo: 'acme/knowledge' }, ...o })
// The account whose GitHub login the Members test of product-settings.spec.ts edits: no other spec signs in as it.
await ensure('bauherren', { email: 'members-edit@example.com' }, { email: 'members-edit@example.com', password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'bauherr', tenants: [{ tenant: workspace }] })
await payload.update({ collection: 'workspaces', id: workspace, data: { knowledgeConnection: github, knowledgeRepo: 'acme/knowledge' }, ...o })
await ensure('repositories', { fullName: 'acme/web' }, { fullName: 'acme/web', product, workspace })
await ensure('ticket_sources', { repo: 'acme/web' }, { repo: 'acme/web', product, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
// workflow-editor.spec.ts: a Workspace of its own (the spec applies factory files and flips Workspace settings), an Admin that only that spec signs in as (cookie `bauherr-ws=editor`), one Product with a ticket source and one Ticket. Twin in `src/lib/fake-forge.ts`.
const editorWs = (await ensure('workspaces', { slug: 'editor' }, { name: 'Editor Lab', slug: 'editor', wipLimits: {} })).id
await ensure('bauherren', { email: 'editor-admin@example.com' }, { email: 'editor-admin@example.com', password, role: 'admin', githubLogin: 'e2e-editor-admin' })
const editorGithub = (await ensure('connections', { name: 'GitHub Editor' }, { name: 'GitHub Editor', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: editorWs })).id
const editorProduct = (await ensure('products', { slug: 'editor-app' }, { name: 'Editor App', slug: 'editor-app', workspace: editorWs })).id
await ensure('repositories', { fullName: 'acme/editor' }, { fullName: 'acme/editor', product: editorProduct, workspace: editorWs })
await ensure('ticket_sources', { repo: 'acme/editor' }, { repo: 'acme/editor', product: editorProduct, connection: editorGithub, cursor: '2026-10-30T09:00:00Z', workspace: editorWs })
await ensure('tickets', { externalId: 'e2e-editor-1' }, { title: 'Editor lab: build the thing', externalId: 'e2e-editor-1', number: 1, url: 'https://github.com/acme/editor/issues/1', state: 'open', labels: ['bauherr:stage:build'], stage: 'build', product: editorProduct, workspace: editorWs, rank: '000030' })
// request-conversation.spec.ts: a Workspace of its own (`bauherr-ws=rc`) with two Products (Rc Web, Rc Api), models as `<connection>/<model>` (the short name is what is shown), a Bauherr and a Product owner (assigned to Rc Web only) that only that spec signs in as. Twins in `src/lib/fake-forge.ts` (acme/rc-web, acme/rc-api).
const rcWs = (await ensure('workspaces', { slug: 'rc' }, { name: 'Request Lab', slug: 'rc', wipLimits: {}, modelByTier: { cheap: 'anthropic/claude-haiku-5-5', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' } })).id
await ensure('bauherren', { email: 'rc-bauherr@example.com' }, { email: 'rc-bauherr@example.com', password, role: 'bauherr', tenants: [{ tenant: rcWs }] })
const rcGithub = (await ensure('connections', { name: 'GitHub Rc' }, { name: 'GitHub Rc', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: rcWs })).id
const rcProducts: number[] = []
for (const [name, slug] of [['Rc Web', 'rc-web'], ['Rc Api', 'rc-api']] as const) {
  const id = (await ensure('products', { slug }, { name, slug, workspace: rcWs })).id as number
  rcProducts.push(id)
  await ensure('repositories', { fullName: `acme/${slug}` }, { fullName: `acme/${slug}`, product: id, workspace: rcWs })
  await ensure('ticket_sources', { repo: `acme/${slug}` }, { repo: `acme/${slug}`, product: id, connection: rcGithub, cursor: '2026-10-30T09:00:00Z', workspace: rcWs })
}
await ensure('bauherren', { email: 'rc-owner@example.com' }, { email: 'rc-owner@example.com', password, role: 'product-owner', assignments: [{ workspace: rcWs, scope: 'products', products: [rcProducts[0]] }] })
// docs-check.spec.ts: a Workspace of its own (`bauherr-ws=docsco`) with one Product (Docs Web) and a Bauherr; the spec starts a docs check there, so no other spec may read it.
const docsWs = (await ensure('workspaces', { slug: 'docsco' }, { name: 'Docs Lab', slug: 'docsco', wipLimits: {}, modelByTier: { cheap: 'anthropic/claude-haiku-5-5', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' } })).id
await ensure('bauherren', { email: 'docs-bauherr@example.com' }, { email: 'docs-bauherr@example.com', password, role: 'bauherr', tenants: [{ tenant: docsWs }] })
const docsGithub = (await ensure('connections', { name: 'GitHub Docs' }, { name: 'GitHub Docs', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: docsWs })).id
const docsProduct = (await ensure('products', { slug: 'docs-web' }, { name: 'Docs Web', slug: 'docs-web', workspace: docsWs })).id
await ensure('repositories', { fullName: 'acme/docsweb' }, { fullName: 'acme/docsweb', product: docsProduct, workspace: docsWs })
await ensure('ticket_sources', { repo: 'acme/docsweb' }, { repo: 'acme/docsweb', product: docsProduct, connection: docsGithub, cursor: '2026-10-30T09:00:00Z', workspace: docsWs })
// conversation.spec.ts: a Workspace of its own (`bauherr-ws=conv`), an Admin and a Product owner only that spec signs in as, and three Tickets held by Triage (#1 the Docs Agent with four open points, #2 and #3 untouched by the first test), each with a succeeded Triage Run of a session. Twin in `src/lib/fake-forge.ts` (acme/conv).
const convWs = (await ensure('workspaces', { slug: 'conv' }, { name: 'Conversation Lab', slug: 'conv', wipLimits: {}, modelByTier: { cheap: 'anthropic/claude-haiku-5-5', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' } })).id
await ensure('bauherren', { email: 'conv-admin@example.com' }, { email: 'conv-admin@example.com', password, role: 'admin', githubLogin: 'e2e-conv-admin' })
const convGithub = (await ensure('connections', { name: 'GitHub Conv' }, { name: 'GitHub Conv', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: convWs })).id
const convProduct = (await ensure('products', { slug: 'conv-app' }, { name: 'Conv App', slug: 'conv-app', workspace: convWs })).id
await ensure('bauherren', { email: 'conv-owner@example.com' }, { email: 'conv-owner@example.com', password, role: 'product-owner', assignments: [{ workspace: convWs, scope: 'products', products: [convProduct] }] })
await ensure('repositories', { fullName: 'acme/conv' }, { fullName: 'acme/conv', product: convProduct, workspace: convWs })
await ensure('ticket_sources', { repo: 'acme/conv' }, { repo: 'acme/conv', product: convProduct, connection: convGithub, cursor: '2026-10-30T09:00:00Z', workspace: convWs })
const convSession = (await ensure('agent_sessions', { publicId: 'ses_e2e_conv' }, { publicId: 'ses_e2e_conv', role: 'orchestrator', label: 'orchestrator-conv@laptop', clientName: 'claude-code', clientVersion: '2.1.0', model: 'claude-sonnet-4-5', provider: 'anthropic', connectedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), workspace: convWs })).id
for (const [n, title] of [[1, 'Docs Agent'], [2, 'Export the invoices'], [3, 'Name the export file']] as const) {
  const t = (await ensure('tickets', { externalId: `e2e-conv-${n}` }, { title, externalId: `e2e-conv-${n}`, number: n, url: `https://github.com/acme/conv/issues/${n}`, state: 'open', labels: ['bauherr:needs-refinement', 'bauherr:type:feature'], stage: null, product: convProduct, workspace: convWs, rank: `00004${n}` })).id
  await ensure('runs', { ticket: t, stage: 'triage', status: 'succeeded' }, { ticket: t, stage: 'triage', status: 'succeeded', mode: 'session', executor: 'session', role: 'orchestrator', session: convSession, sessionLabel: 'orchestrator-conv@laptop', model: 'claude-sonnet-4-5', workspace: convWs })
}
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
// #42: the twin of #24 that its test uses on a retry (the first attempt answered and approved #24); twin in `src/lib/fake-forge.ts`.
const t42 = await ticket(42, 'Switch the dashboard to a light theme', 'plan', product, openCritical)
// Own Tickets of the next-step button cases in ticket.spec.ts (#385): #25 an approved plan held by an overlap, #26 a plan awaiting approval, #27 a Build with a live Run. Twins in `src/lib/fake-forge.ts` carry these numbers.
await ticket(25, 'Hold the approved export tweak', 'plan', product, { labels: ['bauherr:stage:plan', 'bauherr:approved:plan'], waitingFor: 'build', waitingReason: 'overlaps #356' })
const t26 = await ticket(26, 'Approve the retry policy', 'plan', product)
const t27 = await ticket(27, 'Review the retry policy', 'review', product)
await run(t26, 'plan', 'succeeded', { startedAt: '2026-10-30T09:40:00Z', finishedAt: '2026-10-30T09:42:00Z' })
// chat-dock.spec.ts: two plans of its own awaiting approval (#28 is approved in the chat, #29 declined; twins in `src/lib/fake-forge.ts`) and a second member who must not see the first one's threads.
for (const [n, title] of [[28, 'Chat: cache the export totals'], [29, 'Chat: rename the export columns']] as const) await run(await ticket(n, title, 'plan', product), 'plan', 'succeeded', { startedAt: '2026-10-30T09:50:00Z', finishedAt: '2026-10-30T09:52:00Z' })
await ensure('bauherren', { email: 'chat-other@example.com' }, { email: 'chat-other@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }] })
// Own Tickets of inbox.spec.ts: #37 a plan to approve, #38 a review at its round cap, #39 a change on staging. Twins in `src/lib/fake-forge.ts` carry these numbers.
const t37 = await ticket(37, 'Rename the sign-in button', 'plan', product)
const t38 = await ticket(38, 'Stop the export retry loop', 'review', product, { reviewState: 'needs_human', reviewRounds: 3 })
await ticket(39, 'Check the new header on staging', 'release', product, { ...rel, stagingTldr: { whatYouGet: '- The header shows the new logo\n- The checks are green', found: '- Nothing recorded.' } })
await run(t37, 'plan', 'succeeded', { startedAt: '2026-10-30T09:50:00Z', finishedAt: '2026-10-30T09:52:00Z' })
const t40 = await ticket(40, 'Hand over the export notes', 'plan', product)
await run(t40, 'plan', 'succeeded', { startedAt: '2026-10-30T09:53:00Z', finishedAt: '2026-10-30T09:54:00Z' })
// #41: ticket-dock.spec.ts's own Ticket, held by Triage with one question (twin in `src/lib/fake-forge.ts`).
await ticket(41, 'Name the export file', 'triage', product, { stage: null, labels: ['bauherr:needs-refinement'] })
await run(t38, 'review', 'succeeded', { startedAt: '2026-10-30T09:55:00Z', finishedAt: '2026-10-30T09:58:00Z', verdict: 'changes', findings: [{ severity: 'medium', file: 'src/export.ts', line: 21, msg: 'The retry loop never stops on a permanent error.', scenario: 'when the export answers 402, then it is retried forever.' }] })
await ensure('runs', { ticket: t27, stage: 'review', status: 'running' }, { ticket: t27, stage: 'review', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
// Hotfix (#373): a card in the Hotfix lane of Build, and a merged one 12 minutes after its flag for the lead time in Factory health.
await ticket(125, 'Hotfix: checkout crash', 'build', product, { expedite: true, expediteAt: '2026-11-05T08:00:00Z', rank: '999999' })
await ticket(126, 'Hotfix: login loop', 'done', product, { state: 'closed', expedite: true, expediteAt: '2026-11-05T08:00:00Z', releaseAt: '2026-11-05T08:12:00Z', releasedAt: '2026-11-05T08:30:00Z' })
await ticket(124, 'Waiting for a Build slot', 'plan', product, { waitingFor: 'build', rank: '000000' })
const live = await ticket(123, 'Live build in progress', 'build', product, { rank: '900000' })
const distilled = await ticket(127, 'Fix the flaky export test', 'done', product, { state: 'closed' })
await ensure('skill_proposals', { ticket: distilled }, { ticket: distilled, workspace, status: 'replayed', pr: 2, skillPath: 'workspace/skills/tdd-first/SKILL.md', score: 1, baselineScore: 0.5 })
// Own Product of the settings-rework cases, so no spec counting Tickets or Runs of the other Products changes. Proposals: #301 is rejected on the Knowledge page (knowledge.spec.ts), #303 on the Inbox card (inbox.spec.ts), #302 skipped and #304 rejected show reason and results (twins of PRs 3 to 5 in `src/lib/fake-forge.ts`).
const extras = (await ensure('products', { slug: 'acme-extras' }, { name: 'Acme Extras', slug: 'acme-extras', workspace })).id
const doneOn = (n: number, title: string, p: string | number, extra: Record<string, unknown> = {}) => ticket(n, title, 'done', p, { state: 'closed', ...extra })
const proposal = async (n: number, title: string, data: Record<string, unknown>) => {
  const t = await doneOn(n, title, extras)
  return ensure('skill_proposals', { ticket: t }, { ticket: t, workspace, ...data })
}
await proposal(301, 'Cache the report totals', { status: 'replayed', pr: 3, skillPath: 'workspace/skills/report-caching/SKILL.md', score: 1, baselineScore: 0.25 })
await proposal(302, 'Rename the export flag', { status: 'skipped', reason: 'one-off lesson' })
await proposal(303, 'Bound the retry loop', { status: 'replayed', pr: 4, skillPath: 'workspace/skills/retry-limits/SKILL.md', score: 0.75, baselineScore: 0.25 })
await proposal(304, 'Name the migration files', { status: 'rejected', pr: 5, reason: 'rejected, the baseline passes without the skill', skillPath: 'workspace/skills/naming/SKILL.md', score: 1, baselineScore: 1, results: { baseline: [{ id: 'names-file', pass: true }], withSkill: [{ id: 'names-file', pass: true }], calls: 4, cost: 0.12 } })
// Merge strip (releases.spec.ts): a Product on a merge train with two queued Tickets (#311 in the running train) and one dropped back to Build once.
const trainProduct = (await ensure('products', { slug: 'acme-train' }, { name: 'Acme Train', slug: 'acme-train', workspace, mergeMode: 'train' })).id
const queued1 = await ticket(311, 'Train: first change', 'done', trainProduct, { reviewState: 'queued' })
await ticket(312, 'Train: second change', 'done', trainProduct, { reviewState: 'queued' })
await ticket(313, 'Train: dropped change', 'done', trainProduct, { trainFailures: 1 })
await payload.update({ collection: 'products', id: trainProduct, data: { trainState: { baseSha: 'base', members: [{ ticket: queued1, pr: 1, headSha: 'h1' }], phase: 'testing', probe: null, results: {}, tip: 'tip', since: '2026-11-05T08:00:00Z' } }, ...o })
// Run chain (run.spec.ts): the second Run of #305 continues the first.
const chained = await doneOn(305, 'Chain: continue the build', extras)
const firstRun = await run(chained, 'build', 'abandoned', { startedAt: '2026-10-30T08:00:00Z', finishedAt: '2026-10-30T08:10:00Z', goal: ['The export button downloads a CSV'] })
await ensure('runs', { ticket: chained, stage: 'build', status: 'succeeded' }, { ticket: chained, stage: 'build', status: 'succeeded', mode: 'autonomous', workspace, previousRun: firstRun.id, startedAt: '2026-10-30T08:11:00Z', finishedAt: '2026-10-30T08:20:00Z', gatewayTokensIn: 1200, gatewayTokensOut: 340 })
// Counters (ticket.spec.ts): #306 shows them next to Reset counters.
await doneOn(306, 'Counters: merge keeps failing', extras, { mergeFailures: 2, trainFailures: 1, conflictReturns: 3, releaseAttempts: 1, triageAttempts: 2, gatePendingAttempts: 4, mainMergeNoops: 1 })
await ensure('runs', { ticket: live, stage: 'build', status: 'running' }, { ticket: live, stage: 'build', status: 'running', mode: 'autonomous', executor: 'runner', model: 'claude-sonnet-4-5', provider: 'anthropic', workspace, startedAt: new Date().toISOString() })
// graph.spec.ts flips the Run of this Ticket to succeeded and back: no other spec reads it (Acme Merge is only opened on its Merging tab).
const graphLive = await ticket(140, 'Graph live build', 'build', mergeProduct, { rank: '900001' })
await ensure('runs', { ticket: graphLive, stage: 'build', status: 'running' }, { ticket: graphLive, stage: 'build', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
await run(t17, 'plan', 'succeeded', { startedAt: '2026-10-30T12:00:00Z', finishedAt: '2026-10-30T12:01:00Z' })
await run(t18, 'plan', 'succeeded', { startedAt: '2026-10-30T12:05:00Z', finishedAt: '2026-10-30T12:06:00Z' })
await run(t18, 'build', 'failed', { reasonKind: 'decision', startedAt: '2026-10-30T12:10:00Z', finishedAt: '2026-10-30T12:12:00Z' })
await run(t24, 'plan', 'succeeded', { startedAt: '2026-10-30T09:30:00Z', finishedAt: '2026-10-30T09:32:00Z' })
await run(t42, 'plan', 'succeeded', { startedAt: '2026-10-30T09:30:00Z', finishedAt: '2026-10-30T09:32:00Z' })
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
const wfSeed = workflowFor(workspace as number)
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
// ticket.spec.ts: a Ticket on Acme Checks that passed a conditional step (`skip:` event, written as `skipEvent` does): the Steps list shows it as Skipped with the reason, it is no visit.
const routed = (await ensure('tickets', { externalId: 'e2e-checks-3' }, { title: 'Check the CSV header', externalId: 'e2e-checks-3', number: 3, url: 'https://github.com/acme/checks/issues/3', state: 'open', labels: ['bauherr:stage:review'], stage: 'review', historyKey: 'review|queued', product: checksProduct, workspace, rank: '000027' })).id
for (const [cause, stage, kind, phase, hoursAgo, extra] of [['e2e:routed:0', 'build', 'build', 'working', 3, {}], ['skip:e2e-security-review', 'e2e-security-review', 'agent', 'queued', 2.5, { note: 'the change touches no security paths', fromStage: 'build' }], ['e2e:routed:2', 'review', 'review', 'queued', 2.5, { fromStage: 'build' }]] as const) {
  await ensure('ticket_events', { ticket: routed, cause }, { ticket: routed, workspace, at: new Date(seedNow - hoursAgo * 3600e3).toISOString(), stage, stageKind: kind, phase, executor: 'factory', cause, ...extra })
}
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
// team.spec.ts: an orchestrator session working on #128 (in Triage, where no other spec reads the executors), an idle reviewer session and a disconnected engineer. A fresh clock each seed; `BAUHERR_SESSION_TIMEOUT_S` keeps them present for the spec.
const teamTicket = await ticket(128, 'Team: triage in a session', 'triage', product)
const now = Date.now()
// proof.spec.ts: a Product of its own with an artifact rule (an image rule on `src/ui/**`) and one Ticket on staging with a before/after pair, a terminal session and a preview link; the request lists three acceptance criteria, the third has no proof. Twin in `src/lib/fake-forge.ts` (acme/proof #1).
const proofProduct = (await ensure('products', { slug: 'acme-proof' }, { name: 'Acme Proof', slug: 'acme-proof', workspace, stagingUrl: 'https://staging.example.com/proof', reviewChecks: { artifacts: [{ name: 'UI screenshots', globs: ['src/ui/**'], kind: 'image', command: 'pnpm screenshots', before: true }] } })).id
await ensure('ticket_sources', { repo: 'acme/proof' }, { repo: 'acme/proof', product: proofProduct, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
const proofTicket = (await ensure('tickets', { externalId: 'e2e-proof-1' }, { title: 'Ship the proof export', externalId: 'e2e-proof-1', number: 1, url: 'https://github.com/acme/proof/issues/1', state: 'open', labels: ['bauherr:stage:release'], ...rel, stagingTldr: { whatYouGet: '- The export page has a Download button', found: '- Nothing recorded.' }, product: proofProduct, workspace, rank: '000330' })).id
await ensure('intake_sessions', { 'draft.problem': 'Download the proof export' }, { product: proofProduct, workspace, status: 'submitted', persona: 'product-user', messages: [], ticketNumber: 1, draft: { problem: 'Download the proof export', context: '', acceptance_criteria: ['The export page shows a Download button', 'Clicking it saves a CSV file', 'Existing exports keep working'], type: 'feature', links: [] } })
/** A flat PNG of a mock page: `button` adds the green Download button the change introduces. */
const mockPage = (button: boolean): string => {
  const [w, h] = [320, 200]
  const px = (x: number, y: number): number[] => (y < 28 ? [31, 41, 55] : button && x >= 24 && x < 124 && y >= 90 && y < 118 ? [22, 163, 74] : x >= 24 && x < 200 && y >= 52 && y < 60 ? [156, 163, 175] : [249, 250, 251])
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, (_, x) => px(x, y)).flat())])))
  const crc = (b: Buffer) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
const proofDoc = (await payload.findByID({ collection: 'tickets', id: proofTicket, depth: 0, ...o })) as Record<string, any>
const proofSha = 'e2e0000proof'
for (const item of [
  { kind: 'image', title: 'Export page before the change', pair: 'before', rule: 'UI screenshots', criterion: 'The export page shows a Download button', file: { name: 'before.png', base64: mockPage(false) } },
  { kind: 'image', title: 'Export page with the Download button', pair: 'after', rule: 'UI screenshots', criterion: 'The export page shows a Download button', file: { name: 'after.png', base64: mockPage(true) } },
  { kind: 'transcript', title: 'Download from a terminal', criterion: 'Clicking it saves a CSV file', text: '$ curl -sO https://staging.example.com/proof/export.csv\n$ head -2 export.csv\ninvoice,total\nINV-1001,120.00' },
  { kind: 'preview', title: 'Try the export page', criterion: 'Clicking it saves a CSV file', url: 'https://preview.example.com/proof/1' },
] as const) await attachProof(payload, proofDoc, { sha: proofSha, item: item as never })
const minutesAgo = (m: number) => new Date(now - m * 6e4).toISOString()
const session = (publicId: string, role: string, label: string, extra: Record<string, unknown> = {}) =>
  ensure('agent_sessions', { publicId }, { publicId, role, label, clientName: 'claude-code', clientVersion: '2.1.0', model: 'claude-sonnet-4-5', provider: 'anthropic', connectedAt: minutesAgo(95), lastSeenAt: minutesAgo(0), workspace, ...extra })
const working = await session('ses_e2e_working', 'orchestrator', 'orchestrator-1@laptop')
await session('ses_e2e_idle', 'reviewer', 'reviewer-1@laptop', { connectedAt: minutesAgo(20) })
await session('ses_e2e_offline', 'engineer', 'engineer-2@devbox', { disconnectedAt: minutesAgo(8), lastSeenAt: minutesAgo(8) })
const teamRun = await ensure('runs', { ticket: teamTicket, stage: 'triage', status: 'running' }, { ticket: teamTicket, stage: 'triage', status: 'running', mode: 'session', executor: 'session', role: 'orchestrator', session: working.id, sessionLabel: 'orchestrator-1@laptop', clientName: 'claude-code', clientVersion: '2.1.0', model: 'claude-sonnet-4-5', provider: 'anthropic', workspace, heartbeatAt: minutesAgo(0), startedAt: minutesAgo(40) })
await ensure('session_spans', { session: working.id, run: teamRun.id }, { session: working.id, run: teamRun.id, ticket: teamTicket, startedAt: minutesAgo(40), lastAt: minutesAgo(0), workspace })
// ticket.spec.ts: #130, a Build whose session Run waits for an agent (the only engineer session above is disconnected).
const waitTicket = await ticket(130, 'Wait for an engineer agent', 'build', product)
await ensure('runs', { ticket: waitTicket, stage: 'build', status: 'awaiting_session' }, { ticket: waitTicket, stage: 'build', status: 'awaiting_session', mode: 'session', workspace })
// insights.spec.ts, team.spec.ts: usage for "Cost & tokens". A done Ticket with a reviewer Run priced by the gateway (Opus), a session Build Run that reported usage (Sonnet; the session's own cost is $0.40) and one more session-reported row that the gateway-priced Run must drop.
const costTicket = await ticket(129, 'Cost: usage seeded', 'done', product, { state: 'closed', labels: [] })
await ensure('ticket_events', { ticket: costTicket, cause: 'e2e:cost' }, { ticket: costTicket, workspace, at: minutesAgo(30), stage: 'done', stageKind: 'done', phase: 'closed', cause: 'e2e:cost' })
const costRun = (stage: string, extra: Record<string, unknown>) => ensure('runs', { ticket: costTicket, stage }, { ticket: costTicket, stage, status: 'succeeded', workspace, startedAt: minutesAgo(50), finishedAt: minutesAgo(35), ...extra })
const costReview = await costRun('review', { mode: 'autonomous', executor: 'runner', role: 'reviewer', model: 'claude-opus-5-5' })
const costBuild = await costRun('build', { status: 'failed', mode: 'session', executor: 'session', role: 'engineer', session: working.id, sessionLabel: 'orchestrator-1@laptop' })
const usage = (run: { id: number | string }, stage: string, role: string, model: string, source: string, costUsd: number | null, sessionId?: number | string) =>
  ensure('usage_entries', { run: run.id, source, model }, { run: run.id, ticket: costTicket, workspace, stage, role, model, source, tokensIn: 12000, tokensOut: 3000, costUsd, at: minutesAgo(35), ...(sessionId && { session: sessionId }) })
await usage(costReview, 'review', 'reviewer', 'claude-opus-5-5', 'gateway', 2.5)
await usage(costBuild, 'build', 'engineer', 'claude-sonnet-5-5', 'session-reported', 0.4, working.id)
await usage(costReview, 'review', 'reviewer', 'claude-opus-5-5', 'session-reported', 40, working.id)
const request = async (key: string, status: string, extra: Record<string, unknown>) =>
  ensure('intake_sessions', { 'draft.problem': key }, { product, workspace, status, persona: 'product-user', messages: [], draft: { problem: key, context: '', acceptance_criteria: [], type: 'bug', links: [] }, ...extra })
await request('Export totals drift', 'open', { user: draftOwner })
await request('Dark theme for the dashboard', 'submitted', { ticketNumber: 1 })
await request('Invoice filter and CSV export', 'submitted', { ticketNumber: 6, ticketNumbers: [6, 7] })
// request-card.spec.ts, requests.spec.ts: a member with a workbench of their own (nothing else signs in as them): a draft (urgent bug), a request that waits for their answer (#601), two they can order (#602, #603), an urgent one waiting for the Bauherr (#604) and a released one (#605; numbers high enough that no fake-forge issue created by another spec collides).
const cardOwner = (await ensure('bauherren', { email: 'card-owner@example.com' }, { email: 'card-owner@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }] })).id
const mine = (key: string, status: string, extra: Record<string, unknown>) => request(key, status, { user: cardOwner, ...extra })
await mine('Checkout is down', 'open', { title: 'Checkout is down', kind: 'bug', urgency: 'urgent', urgentReason: 'Checkout is down for all customers since 9.', messages: [{ role: 'user', content: 'Checkout is down' }], draft: { title: 'Checkout is down', problem: 'Checkout is down', context: 'Checkout page', acceptance_criteria: [], type: 'bug', urgency: 'urgent', urgent_reason: 'Checkout is down for all customers since 9.', links: [] } })
const kinded = (n: number, title: string, kind: string, extra: Record<string, unknown> = {}) => ({ title, kind, ticketNumber: n, draft: { title, problem: title, context: '', acceptance_criteria: [], type: kind, links: [] }, ...extra })
const typed = (kind: string) => [`bauherr:type:${kind}`, `type:${kind}`]
await ticket(601, 'Add an invoice filter', 'triage', product, { stage: null, labels: ['bauherr:needs-refinement', ...typed('feature')] })
await mine('Add an invoice filter', 'submitted', kinded(601, 'Add an invoice filter', 'feature'))
await ticket(602, 'CSV export misses its total row', 'build', product, { labels: ['bauherr:stage:build', ...typed('bug')] })
await mine('CSV export misses its total row', 'submitted', kinded(602, 'CSV export misses its total row', 'bug'))
await ticket(603, 'Show the due date on invoices', 'plan', product, { labels: ['bauherr:stage:plan', ...typed('change')] })
await mine('Show the due date on invoices', 'submitted', kinded(603, 'Show the due date on invoices', 'change'))
await ticket(604, 'Checkout fails for every customer', 'triage', product, { stage: null, labels: ['bauherr:expedite-proposed', ...typed('bug')] })
await mine('Checkout fails for every customer', 'submitted', kinded(604, 'Checkout fails for every customer', 'bug', { urgency: 'urgent', urgentReason: 'Checkout is down for all customers since 9.' }))
const released = await ticket(605, 'Dark theme for the invoice page', 'done', product, { state: 'closed', labels: typed('feature'), mergeSha: 'sha-605', releasedIn: 'v0.4.0', stagingTldr: { whatYouGet: '- The invoice page follows the dark theme.\n**Found:** nothing', found: 'nothing' } })
await mine('Dark theme for the invoice page', 'submitted', kinded(605, 'Dark theme for the invoice page', 'feature'))
const sentAt = (m: number) => new Date(now - m * 6e4).toISOString()
for (const [at, stage, kind, phase, cause] of [[600, 'triage', 'triage', 'working', 'poll'], [580, 'plan', 'plan', 'queued', 'run:queued'], [560, 'plan', 'plan', 'queued', 'gate:approve:plan'], [500, 'review', 'review', 'working', 'run:claimed'], [400, 'release', 'release', 'ci', 'release:on_staging'], [380, 'release', 'release', 'queued', 'gate:accept:staging'], [300, 'done', 'done', 'closed', 'poll']] as const) await ensure('ticket_events', { ticket: released, cause, at: sentAt(at) }, { ticket: released, workspace, at: sentAt(at), stage, stageKind: kind, phase, cause })
// product-owner-view.spec.ts: a Workspace of its own with two Products (Lab Alpha, Lab Beta), a Product owner assigned to Lab Alpha only and a Bauherr of the Workspace for comparison (nothing else signs in as them). Each Product has one Ticket (#1, in Build), one sent request and one review artifact; the Product owner also has a draft. Twins in `src/lib/fake-forge.ts` (acme/lab-alpha #1, acme/lab-beta #1).
const lab = (await ensure('workspaces', { slug: 'po-lab' }, { name: 'PO Lab', slug: 'po-lab', wipLimits: {} })).id
const labHub = (await ensure('connections', { name: 'GitHub Lab' }, { name: 'GitHub Lab', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: lab })).id
const labBauherr = (await ensure('bauherren', { email: 'po-view-bauherr@example.com' }, { email: 'po-view-bauherr@example.com', password, role: 'bauherr', tenants: [{ tenant: lab }], githubLogin: 'e2e-po-view' })).id
for (const [slug, name, repo] of [['lab-alpha', 'Lab Alpha', 'acme/lab-alpha'], ['lab-beta', 'Lab Beta', 'acme/lab-beta']] as const) {
  const labProduct = (await ensure('products', { slug }, { name, slug, workspace: lab, stagingUrl: `https://staging.example.com/${slug}` })).id
  await ensure('repositories', { fullName: repo }, { fullName: repo, product: labProduct, workspace: lab })
  await ensure('ticket_sources', { repo }, { repo, product: labProduct, connection: labHub, cursor: '2026-10-30T09:00:00Z', workspace: lab })
  const labTicket = (await ensure('tickets', { externalId: `e2e-${slug}-1` }, { title: `${name} ticket`, externalId: `e2e-${slug}-1`, number: 1, url: `https://github.com/${repo}/issues/1`, state: 'open', labels: ['bauherr:stage:build'], stage: 'build', product: labProduct, workspace: lab, rank: '000900' })).id
  await ensure('runs', { ticket: labTicket, stage: 'build', status: 'running' }, { ticket: labTicket, stage: 'build', status: 'running', mode: 'autonomous', workspace: lab, model: 'claude-lab-secret-model', costUsd: 1.234 })
  await ensure('artifacts', { title: `${name} report` }, { ticket: labTicket, workspace: lab, kind: 'report', title: `${name} report`, text: `All checks of ${name} are green`, sha: 'lab1234' })
  await ensure('intake_sessions', { title: `${name} request` }, { product: labProduct, workspace: lab, status: 'submitted', persona: 'product-user', messages: [], user: labBauherr, title: `${name} request`, kind: 'feature', ticketNumber: 1, draft: { title: `${name} request`, problem: `${name} needs a change`, context: '', acceptance_criteria: ['The change works'], type: 'feature', links: [] } })
  if (slug === 'lab-alpha') {
    const labOwner = (await ensure('bauherren', { email: 'po-view@example.com' }, { email: 'po-view@example.com', password, role: 'product-owner', assignments: [{ workspace: lab, scope: 'products', products: [labProduct] }] })).id
    await ensure('intake_sessions', { title: 'Lab Alpha draft' }, { product: labProduct, workspace: lab, status: 'open', persona: 'product-user', user: labOwner, title: 'Lab Alpha draft', kind: 'bug', messages: [{ role: 'user', content: 'Something is off' }], draft: { title: 'Lab Alpha draft', problem: 'Something is off', context: '', acceptance_criteria: [], type: 'bug', links: [] } })
  }
}
// checkpoints-who.spec.ts: a Workspace of its own (`who-lab`), a Bauherr and a Product owner only that spec signs in as. Who Alpha has the Product owner and "Product owner tests on staging" on, Who Beta has no Product owner. Each Product has #1 on staging, #2 a plan to approve (the Bauherr's) and #3 held by Triage with a mixed sheet. Twins in `src/lib/fake-forge.ts` (acme/who-alpha, acme/who-beta).
const who = (await ensure('workspaces', { slug: 'who-lab' }, { name: 'Who Lab', slug: 'who-lab', wipLimits: {} })).id
// The shipped default factory file (the CI job runs on the gated pack, which asks the Bauherr everywhere): the Product owner is asked for Triage's questions and staging acceptance in this Workspace.
{
  const doc = parseDocument(readFileSync(resolve(corePack(), 'factory.yaml'), 'utf8')).toJS() as Record<string, any>
  inlineProfiles(doc, corePack(), [])
  const applied = await applyFactory(payload, who as number, stringify(doc), { by: 'seed', via: 'seed', note: 'who-lab: the shipped default' })
  if (!applied.ok) throw new Error(`who-lab factory file: ${applied.findings.join('; ')}`)
}
const whoHub = (await ensure('connections', { name: 'GitHub Who' }, { name: 'GitHub Who', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace: who })).id
await ensure('bauherren', { email: 'who-bauherr@example.com' }, { email: 'who-bauherr@example.com', password, role: 'bauherr', tenants: [{ tenant: who }], githubLogin: 'e2e-who-bauherr' })
for (const [slug, name, repo] of [['who-alpha', 'Alpha', 'acme/who-alpha'], ['who-beta', 'Beta', 'acme/who-beta']] as const) {
  const whoProduct = (await ensure('products', { slug }, { name: `Who ${name}`, slug, workspace: who, stagingUrl: `https://staging.example.com/${slug}`, productOwnerTestsStaging: slug === 'who-alpha' })).id
  await ensure('repositories', { fullName: repo }, { fullName: repo, product: whoProduct, workspace: who })
  await ensure('ticket_sources', { repo }, { repo, product: whoProduct, connection: whoHub, cursor: '2026-10-30T09:00:00Z', workspace: who })
  const whoTicket = (n: number, title: string, data: Record<string, unknown>) => ensure('tickets', { externalId: `e2e-${slug}-${n}` }, { title: `${name}: ${title}`, externalId: `e2e-${slug}-${n}`, number: n, url: `https://github.com/${repo}/issues/${n}`, state: 'open', product: whoProduct, workspace: who, rank: `00${n}0`, ...data })
  await whoTicket(1, 'check the new header on staging', { labels: ['bauherr:stage:release'], stage: 'release', releaseState: 'on_staging', mergeSha: `sha-${slug}-1`, releaseAt: new Date().toISOString(), stagingTldr: { whatYouGet: '- The header is bigger.\n**Found:** nothing', found: 'nothing' } })
  const plan = (await whoTicket(2, 'approve the retry policy', { labels: ['bauherr:stage:plan'], stage: 'plan' })).id
  await ensure('runs', { ticket: plan, stage: 'plan', status: 'succeeded' }, { ticket: plan, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: who })
  await whoTicket(3, 'settle the header copy', { labels: ['bauherr:needs-refinement', 'bauherr:type:feature'], stage: null })
  if (slug === 'who-alpha') await ensure('bauherren', { email: 'who-po@example.com' }, { email: 'who-po@example.com', password, role: 'product-owner', assignments: [{ workspace: who, scope: 'products', products: [whoProduct] }] })
}
// No sweeper runs in e2e: fill `tickets.needsYou` (the top bar's count) the way the gate sweep does.
for (const t of (await payload.find({ collection: 'tickets', pagination: false, depth: 0, ...o })).docs as Record<string, any>[]) {
  const latest = (await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, sort: '-createdAt', limit: 1, depth: 0, ...o })).docs[0] as unknown as { stage: string; status: string; reasonKind?: string | null } | undefined
  const productDoc = (await payload.findByID({ collection: 'products', id: t.product, depth: 0, ...o })) as Record<string, any>
  const wfT = workflowFor(t.workspace)
  const need = needsOf(wfT, t, latest ?? null, !hasProductionChecks(productDoc), (await productGates(payload, wfT, t.workspace, [productDoc as { id: number }]))(t.product))
  // Whom it asks (the sweep's `needsBy`): the workflow's addressee, the Bauherr where the Product has no Product owner.
  const nominal = need ? needBy(wfT, need, t.stage) : null
  const needsBy = need ? askedOf(nominal!, nominal === 'product-owner' && (await productOwnersOfTicket(payload, t)).length > 0) : null
  // Plans awaiting approval carry the TL;DR their Plan Run would have posted; every need gets the Decision the sweep would prepare.
  const planTldr = need === 'Approve plan' || need === 'Answer decisions' ? { decision: `Approve the plan for ${t.title}`, recommendation: 'Approve; the change is small and has a test.', why: ['Two small steps', 'No data is touched', 'A regression test is added'], risk: 'none', options: [] } : t.planTldr
  const row = { ...t, planTldr }
  const decision = need ? await prepareDecision(payload, row, need, latest ?? null) : null
  await payload.update({ collection: 'tickets', id: t.id, data: { needsYou: need, needsBy, decision, planTldr: planTldr ?? null }, ...o })
}
console.log('seeded')
process.exit(0)
