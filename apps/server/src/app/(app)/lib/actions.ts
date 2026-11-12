'use server'
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { NotInWorkspace, NotReleasable, decide, acceptStaging, approvePlan, expedite, backToBacklog, backToBuild, approveProduction, approveSkillProposal, approveSkillProposalOf, rejectSkillProposal, grantReviewRound, stopReview, rankTicket, rankFirst, releaseLock, repairTicket, relinkRunMr, NotAdmin, type Repair, requestChanges, personOf, CommentRefused, postCommentFromChat, startOwnerIntake, askOwnerIntake } from '../../../lib/actions'
import { attachImage, chooseProduct, discardRequest, editCard, removeImage, requestCard, type CardPatch } from '../../../lib/chat/request'
import type { CardData } from '../../../lib/intake/card'
import { orderOwnRequests } from '../../../lib/request-order'
import { startRunIfNeeded } from '../../../jobs'
import { workflowFor } from '../../../lib/factory'
import { SKILL_NEED } from '../../../lib/checkpoints'
import { type DecisionAction, canDecide, settleDecision } from '../../../lib/decision'
import { repairable } from '../../../lib/workflow'
import { RERUNNABLE } from './run'
import { EditRefused, saveDocument } from '../../../lib/knowledge-edit'
import { SESSION_COOKIE } from '../../../lib/oidc-session'
import { clientIp, LoginBusy, signInWithPassword } from '../../../lib/login-lock'
import { id } from '../../../lib/release'
import { emptyDraft } from '../../../lib/intake/engine'
import { requestsVisibleTo } from './requests'
import { currentWorkspace, payloadClient, WS_COOKIE, workspacesOf, requireBauherr } from './session'

export async function login(form: FormData) {
  const payload = await payloadClient()
  let token: string | undefined
  const email = String(form.get('email'))
  try {
    token = (await signInWithPassword(payload, email, String(form.get('password')), clientIp(await headers()))).token
  } catch (e) {
    // A wrong password and too many sign-ins at once get the same generic error: neither says whether the account exists.
    if (!(e instanceof LoginBusy) && (e as { status?: number }).status !== 401) throw e
  }
  if (!token) redirect('/login?error=1')
  const cookie = generatePayloadCookie({ collectionAuthConfig: payload.collections.bauherren.config.auth, cookiePrefix: payload.config.cookiePrefix, token, returnCookieAsObject: true })
  ;(await cookies()).set(cookie.name, cookie.value ?? token, { httpOnly: true, path: '/', sameSite: 'lax', secure: cookie.secure, expires: cookie.expires ? new Date(cookie.expires) : undefined })
  redirect('/')
}

export async function logout() {
  const payload = await payloadClient()
  // Revoke this session server-side; the cookie goes regardless.
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

/** The acting Bauherr and the selected Workspace; 404 when none is selected. */
const acting = async () => {
  const { workspace } = await currentWorkspace()
  if (!workspace) notFound()
  return { user: await requireBauherr(), payload: await payloadClient(), workspaceId: workspace.id }
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

/** "Needs you" on a stuck review: back to Build, with an optional note for the next Run. */
export async function backToBuildAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(backToBuild(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

/** "Cancelled": the Ticket goes back to Triage. */
export async function backToBacklogAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(backToBacklog(payload, user, { ticket, workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

export async function requestChangesAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(requestChanges(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
}

/** Discards one of the caller's open drafts and its conversation ("Discard" on the Requests page and "Discard draft" on the Request page). */
export async function discardIntake(session: number) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(discardRequest({ payload, user, workspace: workspaceId }, session))
  revalidatePath('/requests')
}

/** The Product select of a request thread in the dock: starts the interview session for a Product of the selected Workspace. Null when the thread or the Product is not theirs. */
export async function chooseRequestProduct(thread: number, product: number): Promise<{ session: number; product: string } | null> {
  const { user, payload, workspaceId } = await acting()
  return chooseProduct({ payload, user, workspace: workspaceId }, thread, product)
}

/** The request card of one of the caller's requests (the dock reloads it after every turn); null when it is not theirs. */
export async function loadRequestCard(session: number): Promise<CardData | null> {
  const { user, payload, workspaceId } = await acting()
  return requestCard({ payload, user, workspace: workspaceId }, session)
}

const cardError = (e: unknown): { error: string } => ({ error: e instanceof Error ? e.message : 'This could not be saved.' })

/** A direct edit of the request card by its author; the next interview turn keeps it. */
export async function editRequestCard(session: number, patch: CardPatch): Promise<{ card: CardData } | { error: string }> {
  const { user, payload, workspaceId } = await acting()
  try {
    const card = await editCard({ payload, user, workspace: workspaceId }, session, patch)
    revalidatePath('/requests')
    return { card }
  } catch (e) {
    return cardError(e)
  }
}

/** Adds an uploaded image (`/api/chat/media`) to the request's screenshots, or removes one. */
export async function changeRequestImage(session: number, mediaId: number, change: 'add' | 'remove'): Promise<{ card: CardData } | { error: string }> {
  const { user, payload, workspaceId } = await acting()
  try {
    return { card: await (change === 'add' ? attachImage : removeImage)({ payload, user, workspace: workspaceId }, session, mediaId) }
  } catch (e) {
    return cardError(e)
  }
}

/** "Report a problem" on a released request: a new Bug draft of the same Product, linked to the original ("Follow-up to #n" on the filed issue). Returns the new request's id. */
export async function reportProblem(session: number): Promise<{ session: number } | { error: string }> {
  const { user, payload, workspaceId } = await acting()
  const o = { overrideAccess: true, depth: 0 } as const
  const from = (await payload.find({ collection: 'intake_sessions', where: { and: [{ id: { equals: session } }, requestsVisibleTo(user, workspaceId), { status: { equals: 'submitted' } }, { persona: { equals: 'product-user' } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  if (!from) return { error: 'This request cannot be followed up.' }
  const created = await payload.create({ collection: 'intake_sessions', data: { product: id(from.product), workspace: workspaceId, persona: 'product-user', status: 'open', messages: [], user: user.id, kind: 'bug', draft: { ...emptyDraft(), type: 'bug' }, edited: ['type'], followUpOf: from.id }, ...o } as never)
  revalidatePath('/requests')
  return { session: Number(created.id) }
}

/** Saves the person's order of their own open requests in one Product (see `orderOwnRequests`). */
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

/** Opens (or resumes) the owner's questions over the Ticket's open decision rows; null when none is open. */
export async function startOwnerChat(ticket: number) {
  const { user, payload, workspaceId } = await acting()
  return inWorkspace(startOwnerIntake(payload, user, { ticket, workspaceId })).catch((e) => {
    if (e instanceof Error && e.message === 'no open questions') return null
    throw e
  })
}

/** A clicked option or typed message: an answer is recorded verbatim, an explain request is answered and records nothing. */
export async function askOwnerChat(session: number, ticket: number, decision: string, text: string, literal?: boolean) {
  const { user, payload, workspaceId } = await acting()
  const next = await inWorkspace(askOwnerIntake(payload, user, { session, decision, text, literal, workspaceId }))
  // The last answer of a Triage hold ends the need now; the sweep would only notice within a minute.
  if ('done' in next && ((await payload.findByID({ collection: 'tickets', id: ticket, depth: 0, overrideAccess: true }).catch(() => null)) as { needsYou?: string | null } | null)?.needsYou === 'Answer questions') await settleDecision(payload, ticket)
  revalidatePath(`/tickets/${ticket}`)
  revalidatePath('/inbox')
  return next
}

/** Starts a new Run of the stage of a failed or needs_human Run (Admin or a member of its Workspace) and records a human touch; null when the Run cannot be re-run by this person. */
const startRerun = async (user: Awaited<ReturnType<typeof requireBauherr>>, payload: Awaited<ReturnType<typeof payloadClient>>, runId: number) => {
  const o = { depth: 0, overrideAccess: true } as const
  const run = (await payload.findByID({ collection: 'runs', id: runId, ...o }).catch(() => null)) as { id: number; ticket: number; stage: string; status: string; workspace: number } | null
  if (!run || !RERUNNABLE.includes(run.status) || !(await workspacesOf(user)).some((w) => w.id === run.workspace)) return null
  const ticket = await payload.findByID({ collection: 'tickets', id: run.ticket, ...o })
  const { run: next, created } = await startRunIfNeeded(payload, ticket, run.stage)
  if (created) await payload.create({ collection: 'human_touches', data: { kind: `rerun:${run.stage}`, ticket: run.ticket, run: next.id, workspace: run.workspace, actor: personOf(user), at: new Date().toISOString() }, overrideAccess: true })
  return { run, next: next.id as number, created }
}

/** Re-runs the stage of a failed or needs_human Run, opens the new Run. */
export async function rerunStage(runId: number) {
  const user = await requireBauherr()
  const payload = await payloadClient()
  const r = await startRerun(user, payload, runId)
  if (!r) redirect(`/runs/${runId}`)
  await settleDecision(payload, r.run.ticket)
  redirect(`/runs/${r.next}${r.created ? '' : '?notice=active'}`)
}

/** One decision of the Inbox card: runs the existing action of the option for the Ticket (a note goes where the action takes one), then closes the card at once. A card for a need the Ticket no longer has is refused. Answers an error text instead of throwing. */
export async function decideAction(ticket: number, need: string, action: DecisionAction, note = '', outcome = ''): Promise<{ error?: string }> {
  const { user, payload, workspaceId } = await acting()
  const a = { ticket, workspaceId }
  try {
    const row = (await payload.findByID({ collection: 'tickets', id: ticket, depth: 0, overrideAccess: true }).catch(() => null)) as { needsYou?: string | null; workspace: unknown } | null
    if (!row || String((row.workspace as { id?: number })?.id ?? row.workspace) !== String(workspaceId)) notFound()
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
    else if (action === 'grantRound') await grantReviewRound(payload, user, a)
    else if (action === 'stopReview') await stopReview(payload, user, { ...a, note })
    else if (action === 'backToBuild') await backToBuild(payload, user, { ...a, note })
    else if (action === 'backToBacklog') await backToBacklog(payload, user, a)
    else if (action === 'expedite') await expedite(payload, user, a)
    else if (action === 'decide') await decide(payload, user, { ...a, outcome, note })
    else if (action === 'rerun') {
      const latest = (await payload.find({ collection: 'runs', where: { ticket: { equals: ticket } }, sort: '-createdAt', limit: 1, depth: 0, overrideAccess: true })).docs[0]
      if (!latest || !(await startRerun(user, payload, latest.id as number))) return { error: 'The latest step cannot be re-run.' }
    } else return { error: 'Open the ticket to do this.' }
  } catch (e) {
    if (e instanceof NotInWorkspace) notFound()
    return { error: e instanceof Error ? e.message : 'The action failed.' }
  }
  await settleDecision(payload, ticket)
  revalidatePath('/inbox')
  revalidatePath(`/tickets/${ticket}`)
  return {}
}

/** Force-releases the lease of a running session Run (Admin only); the successor Run is claimable at once. */
export async function releaseRunLock(runId: number) {
  const user = await requireBauherr()
  if (user.role !== 'admin') redirect(`/runs/${runId}`)
  await releaseLock(await payloadClient(), user, { runId }).catch((e) => {
    if (!(e instanceof NotInWorkspace || e instanceof NotReleasable)) throw e
  })
  redirect(`/runs/${runId}`)
}

/** Persists a Board drop: the Ticket now sits between `before` and `after` (Admin or Workspace member, selected Workspace only). */
export async function rankTicketAction(ticket: number, before: number | null, after: number | null) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(rankTicket(payload, user, { ticket, before, after, workspaceId }))
  revalidatePath('/')
}

/** Persists "Send to top of the queue": first among the Workspace's Tickets of its stage group. */
export async function rankFirstAction(ticket: number) {
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(rankFirst(payload, user, { ticket, workspaceId }))
  revalidatePath('/')
}

export type EditState = { pr?: { number: number; url: string }; stale?: { sha: string; diff: string }; error?: string }

/** Saves a Knowledge document as a PR (merged later by the watcher); a stale base returns the diff instead of writing. */
export async function saveKnowledgeDocument(_prev: EditState, fd: FormData): Promise<EditState> {
  const { user, payload, workspaceId } = await acting()
  try {
    return await saveDocument(payload, user, { workspace: workspaceId, path: String(fd.get('path')), content: String(fd.get('content')).replace(/\r\n/g, '\n'), baseSha: String(fd.get('baseSha')) })
  } catch (e) {
    if (e instanceof EditRefused) return { error: e.message }
    throw e
  }
}

/** The docked chat's `/comment`: posts text and the composer's pasted images (media ids from the chat upload) to the Ticket's issue. */
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

/** Admin "Fix state" on the Ticket page. The disclosure posts `kind` (and `stage`); answers an error text instead of throwing. */
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

/** Admin: relink a Build Run to its replacement MR (Run page). */
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
