'use server'
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { NotInWorkspace, NotReleasable, RunHealthy, completeOwnerReview, decide, acceptStaging, approvePlan, expedite, backToBacklog, releaseLane, backToBuild, approveProduction, approveSkillProposal, approveSkillProposalOf, rejectSkillProposal, grantReviewRound, stopReview, parkEpic, resumeEpic, discardEpic, rankTicket, rankFirst, releaseLock, repairTicket, relinkRunMr, NotAdmin, type Repair, requestChanges, personOf, CommentRefused, postCommentFromChat, sendBack } from '../../../lib/actions'
import { discardRequest, loadRequestView, requestEdit, requestFile, type CardPatch, type RequestView } from '../../../lib/request-conversation'
import { orderOwnRequests } from '../../../lib/request-order'
import { startRunOrRejoin } from '../../../jobs'
import { jobExtra } from '../../../lib/stage-jobs'
import { workflowFor } from '../../../lib/factory'
import { SKILL_NEED } from '../../../lib/checkpoints'
import type { SeenKey } from '../../../lib/inbox-seen'
import { type DecisionAction, canDecide, settleDecision } from '../../../lib/decision'
import { repairable } from '../../../lib/workflow'
import { RERUNNABLE } from './run'
import { EditRefused, saveDocument } from '../../../lib/knowledge-edit'
import { SESSION_COOKIE } from '../../../lib/oidc-session'
import { clientIp, LoginBusy, signInWithPassword } from '../../../lib/login-lock'
import { canSeeProduct, homeOf, isBauherr, requestsVisibleTo } from '../../../lib/people'
import { id } from '../../../lib/release'
import { emptyDraft } from '../../../lib/intake/engine'
import { loadRefine, refineModel, refineOption, refineRecommended, refineReopen, refineSend, refineTurn, refineWhy, type View as RefineView } from '../../../lib/refine/engine'
import { type Bauherr, currentPersonWorkspace, currentWorkspace, payloadClient, WS_COOKIE, workspacesOf, requireBauherr } from './session'

export async function login(form: FormData) {
  const payload = await payloadClient()
  let token: string | undefined
  let home = '/'
  const email = String(form.get('email'))
  try {
    const result = await signInWithPassword(payload, email, String(form.get('password')), clientIp(await headers()))
    token = result.token
    home = homeOf(result.user)
  } catch (e) {
    if (!(e instanceof LoginBusy) && (e as { status?: number }).status !== 401) throw e
  }
  if (!token) redirect('/login?error=1')
  const cookie = generatePayloadCookie({ collectionAuthConfig: payload.collections.bauherren.config.auth, cookiePrefix: payload.config.cookiePrefix, token, returnCookieAsObject: true })
  ;(await cookies()).set(cookie.name, cookie.value ?? token, { httpOnly: true, path: '/', sameSite: 'lax', secure: cookie.secure, expires: cookie.expires ? new Date(cookie.expires) : undefined })
  redirect(home)
}

export async function logout() {
  const payload = await payloadClient()
  const { user } = await payload.auth({ headers: await headers() })
  if (user) await payload.update({ collection: 'bauherren', id: user.id, data: { sessionVersion: ((user as { sessionVersion?: number }).sessionVersion ?? 0) + 1 }, overrideAccess: true, depth: 0 }).catch(() => undefined)
  if (user) await logoutOperation({ collection: payload.collections.bauherren, req: await createLocalReq({ user }, payload) }).catch(() => undefined)
  const jar = await cookies()
  jar.delete(`${payload.config.cookiePrefix}-token`)
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}

export async function selectWorkspace(slug: string) {
  if ((await workspacesOf(await requireBauherr())).some((w) => w.slug === slug)) {
    ;(await cookies()).set(WS_COOKIE, slug, { path: '/', sameSite: 'lax', maxAge: 31536000 })
  }
  redirect('/')
}

type Doc = Record<string, any>

const acting = async () => {
  const { workspace } = await currentWorkspace()
  if (!workspace) notFound()
  return { user: await requireBauherr(), payload: await payloadClient(), workspaceId: workspace.id }
}

const actingPerson = async () => {
  const { user, workspace } = await currentPersonWorkspace()
  if (!workspace) notFound()
  return { user, payload: await payloadClient(), workspaceId: workspace.id }
}

const inWorkspace = <T>(run: Promise<T>): Promise<T> =>
  run.catch((e) => {
    if (e instanceof NotInWorkspace) notFound()
    throw e
  })

export async function approvePlanAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(approvePlan(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function expediteAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(expedite(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function decideOutcomeAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(decide(payload, user, { ticket, outcome: String(form.get('outcome') ?? ''), workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

export async function acceptStagingAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(acceptStaging(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function approveProductionAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(approveProduction(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function approveSkillProposalAction(form: FormData) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(approveSkillProposal(payload, user, { proposal: Number(form.get('proposal')), expectSha: String(form.get('expectSha') ?? ''), workspaceId }))
  revalidatePath('/knowledge')
}

export async function rejectSkillProposalAction(form: FormData) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(rejectSkillProposal(payload, user, { proposal: Number(form.get('proposal')), note: String(form.get('note') ?? ''), workspaceId }))
  revalidatePath('/knowledge')
  revalidatePath('/inbox')
}

export async function grantReviewRoundAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(grantReviewRound(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function stopReviewAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(stopReview(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function backToBuildAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(backToBuild(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function backToBacklogAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(backToBacklog(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function sendBackAction(form: FormData): Promise<{ error?: string }> {
  const ticket = Number(form.get('ticket'))
  const option = String(form.get('option'))
  const note = String(form.get('note') ?? '').trim()
  if (option === 'requestChanges' && !note) return { error: 'Say what needs to change.' }
  const { user, payload, workspaceId } = await acting()
  try {
    if (option === 'backToBuild') await inWorkspace(backToBuild(payload, user, { ticket, note, workspaceId }))
    else if (option === 'backToBacklog') await inWorkspace(backToBacklog(payload, user, { ticket, workspaceId }))
    else if (option.startsWith('to:')) {
      if (!isBauherr(user)) return { error: 'Only a Bauherr can do this.' }
      await inWorkspace(sendBack(payload, user, { ticket, to: option.slice(3), note, workspaceId }))
    }
    else if (option === 'requestChanges') await inWorkspace(requestChanges(payload, user, { ticket, note, workspaceId }))
    else return { error: 'Unknown outcome.' }
    await settleDecision(payload, ticket)
  } catch (e) {
    if (String((e as { digest?: unknown }).digest ?? '').startsWith('NEXT_')) throw e
    return { error: e instanceof Error ? e.message : 'That did not go through.' }
  }
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
  return {}
}

export async function epicAction(form: FormData): Promise<{ error?: string }> {
  const ticket = Number(form.get('ticket'))
  const option = String(form.get('option'))
  const { user, payload, workspaceId } = await acting()
  try {
    if (option === 'park') await inWorkspace(parkEpic(payload, user, { ticket, workspaceId }))
    else if (option === 'resume') await inWorkspace(resumeEpic(payload, user, { ticket, workspaceId }))
    else if (option === 'discard') await inWorkspace(discardEpic(payload, user, { ticket, workspaceId }))
    else return { error: 'Unknown action.' }
  } catch (e) {
    if (String((e as { digest?: unknown }).digest ?? '').startsWith('NEXT_')) throw e
    return { error: e instanceof Error ? e.message : 'That did not go through.' }
  }
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/')
  return {}
}

export async function requestChangesAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(requestChanges(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

const requestWho = async () => {
  const { user, payload, workspaceId } = await actingPerson()
  return { user: user as Doc, payload, workspace: workspaceId }
}

export async function discardIntake(session: number) {
  const w = await requestWho()
  await inWorkspace(discardRequest(w, session))
  revalidatePath('/requests')
}

const cardError = (e: unknown): { error: string } => ({ error: e instanceof Error ? e.message : 'This could not be saved.' })

const requesting = async (run: (w: Awaited<ReturnType<typeof requestWho>>) => Promise<RequestView | null>, lists = false): Promise<{ view: RequestView | null } | { error: string }> => {
  const w = await requestWho()
  try {
    const view = await run(w)
    if (lists) revalidatePath('/requests')
    return { view }
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith('NEXT_')) throw e
    return cardError(e)
  }
}

export const requestState = async (session: number) => requesting((w) => loadRequestView(w, session))
export const requestChange = async (session: number, change: { patch: CardPatch } | { removeImage: number }) => requesting((w) => requestEdit(w, session, change))
export const requestSubmit = async (session: number) => requesting((w) => requestFile(w, session), true)

export async function reportProblem(session: number): Promise<{ session: number } | { error: string }> {
  const { user, payload, workspaceId } = await acting()
  const o = { overrideAccess: true, depth: 0 } as const
  const from = (await payload.find({ collection: 'intake_sessions', where: { and: [{ id: { equals: session } }, requestsVisibleTo(user, workspaceId), { status: { equals: 'submitted' } }, { persona: { equals: 'product-user' } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  if (!from) return { error: 'This request cannot be followed up.' }
  const created = await payload.create({ collection: 'intake_sessions', data: { product: id(from.product), workspace: workspaceId, persona: 'product-user', status: 'open', messages: [], user: user.id, kind: 'bug', draft: { ...emptyDraft(), type: 'bug' }, edited: ['type'], followUpOf: from.id }, ...o } as never)
  revalidatePath('/requests')
  return { session: Number(created.id) }
}

export async function orderRequests(ticketIds: number[]): Promise<{ error?: string }> {
  const { user, payload, workspaceId } = await acting()
  try {
    await orderOwnRequests(payload, user, workspaceId, ticketIds)
    revalidatePath('/requests')
    return {}
  } catch (e) {
    return cardError(e)
  }
}

const refining = async <T extends { ticket: number }>(a: T, run: (x: { user: Doc; payload: Awaited<ReturnType<typeof payloadClient>>; workspaceId: number } & T) => Promise<RefineView | null>, person = true): Promise<{ view: RefineView | null } | { error: string }> => {
  const ctx = person ? await actingPerson() : await acting()
  try {
    const view = await inWorkspace(run({ ...ctx, ...a }))
    revalidatePath(`/tickets/${a.ticket}`)
    revalidatePath('/inbox')
    return { view }
  } catch (e) {
    if ((e as { digest?: string }).digest?.startsWith('NEXT_')) throw e
    return { error: e instanceof Error ? e.message : 'The conversation failed.' }
  }
}

export const refineState = async (ticket: number) => refining({ ticket }, (x) => loadRefine(x.payload, x.user, { ticket, workspaceId: x.workspaceId }))
export const refineSay = async (ticket: number, text: string) => refining({ ticket }, (x) => refineTurn(x.payload, x.user, { ticket, workspaceId: x.workspaceId, text }))
export const refinePick = async (ticket: number, point: string, option: number) => refining({ ticket }, (x) => refineOption(x.payload, x.user, { ticket, workspaceId: x.workspaceId, point, option }))
export const refineExplain = async (ticket: number, point: string) => refining({ ticket }, (x) => refineWhy(x.payload, x.user, { ticket, workspaceId: x.workspaceId, point }))
export const refineRest = async (ticket: number) => refining({ ticket }, (x) => refineRecommended(x.payload, x.user, { ticket, workspaceId: x.workspaceId }))
export const refineTier = async (ticket: number, tier: string) => refining({ ticket }, (x) => refineModel(x.payload, x.user, { ticket, workspaceId: x.workspaceId, tier }), false)
export const refineChange = async (ticket: number, point: string) => refining({ ticket }, (x) => refineReopen(x.payload, x.user, { ticket, workspaceId: x.workspaceId, point }))
export const refineFinish = async (ticket: number) => refining({ ticket }, (x) => refineSend(x.payload, x.user, { ticket, workspaceId: x.workspaceId }))

const startRerun = async (user: Awaited<ReturnType<typeof requireBauherr>>, payload: Awaited<ReturnType<typeof payloadClient>>, runId: number) => {
  const o = { depth: 0, overrideAccess: true } as const
  const run = (await payload.findByID({ collection: 'runs', id: runId, ...o }).catch(() => null)) as { id: number; ticket: number; stage: string; status: string; workspace: number; job?: string | null } | null
  if (!run || !RERUNNABLE.includes(run.status) || !(await workspacesOf(user)).some((w) => w.id === run.workspace)) return null
  const ticket = await payload.findByID({ collection: 'tickets', id: run.ticket, ...o })
  const started = await startRunOrRejoin(payload, ticket, run.stage, jobExtra(run))
  if (!started) return { run, next: null, created: false }
  const { run: next, created } = started
  if (created) await payload.create({ collection: 'human_touches', data: { kind: `rerun:${run.stage}`, ticket: run.ticket, run: next.id, workspace: run.workspace, actor: personOf(user), at: new Date().toISOString() }, overrideAccess: true })
  return { run, next: next.id as number, created }
}

export async function rerunStage(runId: number) {
  const user = await requireBauherr()
  const payload = await payloadClient()
  const r = await startRerun(user, payload, runId)
  if (!r) redirect(`/runs/${runId}`)
  await settleDecision(payload, r.run.ticket)
  redirect(r.next ? `/runs/${r.next}${r.created ? '' : '?notice=active'}` : `/tickets/${r.run.ticket}`)
}

export async function decideAction(ticket: number, need: string, action: DecisionAction, note = '', outcome = ''): Promise<{ error?: string }> {
  const { user, payload, workspaceId } = await actingPerson()
  const a = { ticket, workspaceId }
  if (!isBauherr(user) && !['approvePlan', 'requestChanges', 'acceptStaging', 'approveProduction', 'decide', 'open'].includes(action)) return { error: 'Only a Bauherr can do this.' }
  try {
    const row = (await payload.findByID({ collection: 'tickets', id: ticket, depth: 0, overrideAccess: true }).catch(() => null)) as { needsYou?: string | null; workspace: unknown; product: unknown } | null
    if (!row || String((row.workspace as { id?: number })?.id ?? row.workspace) !== String(workspaceId) || !canSeeProduct(user, { id: id(row.product), workspace: workspaceId })) notFound()
    if (need === SKILL_NEED) {
      if (!canDecide(user, need)) return { error: 'Only an Admin can decide this.' }
      const proposal = (await payload.find({ collection: 'skill_proposals', where: { ticket: { equals: ticket } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
      if (!proposal || !['proposed', 'replayed'].includes(String(proposal.status))) return { error: 'This decision changed. Reload the Inbox.' }
      if (action === 'approveSkill') await approveSkillProposalOf(payload, user, a)
      else if (action === 'rejectSkill') await rejectSkillProposal(payload, user, { proposal: proposal.id as number, note, workspaceId })
      else return { error: 'Open the Knowledge page to do this.' }
      revalidatePath('/inbox')
      revalidatePath('/knowledge')
      return {}
    }
    if (row.needsYou !== need) return { error: 'This decision changed. Reload the Inbox.' }
    if (!canDecide(user, need as never)) return { error: 'Only an Admin can decide this.' }
    if (action === 'approvePlan') await approvePlan(payload, user, a)
    else if (action === 'requestChanges') await requestChanges(payload, user, { ...a, note })
    else if (action === 'acceptStaging') await acceptStaging(payload, user, a)
    else if (action === 'approveProduction') await approveProduction(payload, user, a)
    else if (action === 'completeReview') await completeOwnerReview(payload, user, a)
    else if (action === 'grantRound') await grantReviewRound(payload, user, a)
    else if (action === 'stopReview') await stopReview(payload, user, { ...a, note })
    else if (action === 'backToBuild') await backToBuild(payload, user, { ...a, note })
    else if (action === 'backToBacklog') await backToBacklog(payload, user, a)
    else if (action === 'expedite') await expedite(payload, user, a)
    else if (action === 'releaseLane') await releaseLane(payload, user, a)
    else if (action === 'decide') await decide(payload, user, { ...a, outcome, note })
    else if (action === 'rerun') {
      const latest = (await payload.find({ collection: 'runs', where: { ticket: { equals: ticket } }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })).docs[0]
      if (!latest || !(await startRerun(user as Bauherr, payload, latest.id as number))) return { error: 'The latest step cannot be re-run.' }
    } else return { error: 'Open the ticket to do this.' }
  } catch (e) {
    if (e instanceof NotInWorkspace) notFound()
    if ((e as { digest?: string }).digest?.startsWith('NEXT_')) throw e
    return { error: e instanceof Error ? e.message : 'The action failed.' }
  }
  await settleDecision(payload, ticket)
  revalidatePath('/inbox')
  revalidatePath(`/tickets/${ticket}`)
  return {}
}

export async function markSeen(key: SeenKey, seen = true): Promise<void> {
  const { user, payload, workspaceId } = await actingPerson()
  const row = (await payload.findByID({ collection: 'tickets', id: key.ticket, depth: 0, overrideAccess: true }).catch(() => null)) as { workspace: unknown; product: unknown } | null
  if (!row || String(id(row.workspace)) !== String(workspaceId) || !canSeeProduct(user, { id: id(row.product), workspace: workspaceId })) notFound()
  const where = { user: { equals: user.id }, ticket: { equals: key.ticket }, need: { equals: key.need }, since: { equals: key.since } }
  const o = { overrideAccess: true, depth: 0 } as const
  if (!seen) {
    await payload.delete({ collection: 'inbox_seen', where, ...o })
    return
  }
  if ((await payload.count({ collection: 'inbox_seen', where, overrideAccess: true })).totalDocs) return
  await payload.create({ collection: 'inbox_seen', data: { workspace: workspaceId, user: user.id, ...key, seenAt: new Date().toISOString() }, ...o }).catch(async (e) => {
    if (!(await payload.count({ collection: 'inbox_seen', where, overrideAccess: true })).totalDocs) throw e
  })
}

export async function releaseRunLock(runId: number) {
  const user = await requireBauherr()
  if (user.role !== 'admin') redirect(`/runs/${runId}`)
  let healthy = false
  await releaseLock(await payloadClient(), user, { runId }).catch((e) => {
    if (e instanceof RunHealthy) healthy = true
    else if (!(e instanceof NotInWorkspace || e instanceof NotReleasable)) throw e
  })
  redirect(healthy ? `/runs/${runId}?notice=healthy` : `/runs/${runId}`)
}

export async function rankTicketAction(ticket: number, before: number | null, after: number | null) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(rankTicket(payload, user, { ticket, before, after, workspaceId }))
  revalidatePath('/')
}

export async function rankFirstAction(ticket: number) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(rankFirst(payload, user, { ticket, workspaceId }))
  revalidatePath('/')
}

export type EditState = { pr?: { number: number; url: string }; stale?: { sha: string; diff: string }; error?: string }

export async function saveKnowledgeDocument(_prev: EditState, fd: FormData): Promise<EditState> {
  const { user, payload, workspaceId } = await acting()
  try {
    return await saveDocument(payload, user, { workspace: workspaceId, path: String(fd.get('path')), content: String(fd.get('content')).replace(/\r\n/g, '\n'), baseSha: String(fd.get('baseSha')) })
  } catch (e) {
    if (e instanceof EditRefused) return { error: e.message }
    throw e
  }
}

export async function postDockComment(ticket: number, body: string, mediaIds: number[]): Promise<{ images: string[] } | { error: string }> {
  const { user, payload, workspaceId } = await acting()
  try {
    return { images: await postCommentFromChat(payload, user, { ticket, workspaceId, body, mediaIds }) }
  } catch (e) {
    if (e instanceof NotInWorkspace) notFound()
    return { error: e instanceof CommentRefused ? e.message : 'The forge did not accept the comment. Your text and images are kept; try again.' }
  }
}

const repairError = (e: unknown): { error: string } => {
  if (e instanceof NotAdmin || e instanceof Error) return { error: e.message }
  throw e
}

export async function repairTicketAction(ticket: number, _prev: { error?: string; saved?: boolean }, fd: FormData): Promise<{ error?: string; saved?: boolean }> {
  const { user, payload, workspaceId } = await acting()
  const kind = String(fd.get('kind'))
  const stage = String(fd.get('stage'))
  const repair: Repair | null = kind === 'stage' && repairable(workflowFor(workspaceId)).includes(stage) ? { kind, stage } : kind === 'clear-waiting' || kind === 'reset-counters' || kind === 'rank-top' ? { kind } : null
  if (!repair) return { error: 'Choose a repair.' }
  try {
    await inWorkspace(repairTicket(payload, user, { ticket, workspaceId, repair }))
  } catch (e) {
    return repairError(e)
  }
  revalidatePath(`/tickets/${ticket}`)
  return { saved: true }
}

export async function relinkRunAction(runId: number, _prev: { error?: string; saved?: boolean }, fd: FormData): Promise<{ error?: string; saved?: boolean }> {
  const { user, payload, workspaceId } = await acting()
  try {
    await inWorkspace(relinkRunMr(payload, user, { runId, workspaceId, prUrl: String(fd.get('prUrl') ?? '').trim() }))
  } catch (e) {
    return repairError(e)
  }
  revalidatePath(`/runs/${runId}`)
  return { saved: true }
}
