'use server'
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { NotInWorkspace, NotReleasable, acceptStaging, approvePlan, expedite, backToBacklog, backToBuild, approveProduction, grantReviewRound, stopReview, rankTicket, rankFirst, releaseLock, repairTicket, relinkRunMr, NotAdmin, REPAIR_STAGES, type Repair, requestChanges, personOf, postComment, CommentRefused, startOwnerIntake, askOwnerIntake, abandonIntake } from '../../../lib/actions'
import { startRunIfNeeded } from '../../../jobs'
import { RERUNNABLE } from './run'
import { EditRefused, saveDocument } from '../../../lib/knowledge-edit'
import { SESSION_COOKIE } from '../../../lib/oidc-session'
import { withLoginLock } from '../../../lib/login-lock'
import { currentWorkspace, payloadClient, WS_COOKIE, workspacesOf, requireBauherr } from './session'

export async function login(form: FormData) {
  const payload = await payloadClient()
  let token: string | undefined
  const email = String(form.get('email'))
  try {
    ;({ token } = await withLoginLock(payload, email, (req) => payload.login({ collection: 'bauherren', data: { email, password: String(form.get('password')) }, req })))
  } catch (e) {
    if ((e as { status?: number }).status !== 401) throw e
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
  revalidatePath(`/tickets/${ticket}`)
}

export async function expediteAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(expedite(payload, user, { ticket, workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

export async function acceptStagingAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(acceptStaging(payload, user, { ticket, workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

export async function approveProductionAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(approveProduction(payload, user, { ticket, workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

export async function grantReviewRoundAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(grantReviewRound(payload, user, { ticket, workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

export async function stopReviewAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(stopReview(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

/** "Needs you" on a stuck review: back to Build, with an optional note for the next Run. */
export async function backToBuildAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(backToBuild(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

/** "Cancelled": the Ticket goes back to Triage. */
export async function backToBacklogAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(backToBacklog(payload, user, { ticket, workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

export async function requestChangesAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(requestChanges(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

/** Discards one of the caller's open request sessions (New request page). */
export async function discardIntake(session: number) {
  const { user, payload } = await acting()
  await inWorkspace(abandonIntake(payload, user, session))
  revalidatePath('/requests/new')
}

/** Opens (or resumes) the owner's chat over the Ticket's open decision rows. */
export async function startOwnerChat(ticket: number) {
  const { user, payload, workspaceId } = await acting()
  return inWorkspace(startOwnerIntake(payload, user, { ticket, workspaceId }))
}

/** A clicked option or typed message: an answer is recorded verbatim, an explain request is answered and records nothing. */
export async function askOwnerChat(session: number, ticket: number, decision: string, text: string, literal?: boolean) {
  const { user, payload, workspaceId } = await acting()
  const next = await inWorkspace(askOwnerIntake(payload, user, { session, decision, text, literal, workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
  return next
}

/** Re-runs the stage of a failed or needs_human Run for an Admin or a member of its Workspace, records a human touch, opens the new Run. */
export async function rerunStage(runId: number) {
  const user = await requireBauherr()
  const payload = await payloadClient()
  const o = { depth: 0, overrideAccess: true } as const
  const run = (await payload.findByID({ collection: 'runs', id: runId, ...o }).catch(() => null)) as { id: number; ticket: number; stage: string; status: string; workspace: number } | null
  if (!run || !RERUNNABLE.includes(run.status) || !(await workspacesOf(user)).some((w) => w.id === run.workspace)) redirect(`/runs/${runId}`)
  const ticket = await payload.findByID({ collection: 'tickets', id: run.ticket, ...o })
  const { run: next, created } = await startRunIfNeeded(payload, ticket, run.stage)
  if (created) await payload.create({ collection: 'human_touches', data: { kind: `rerun:${run.stage}`, ticket: run.ticket, run: next.id, workspace: run.workspace, actor: personOf(user), at: new Date().toISOString() }, overrideAccess: true })
  redirect(`/runs/${next.id}${created ? '' : '?notice=active'}`)
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

/** Posts a Ticket comment with its uploaded images; answers the image links or an error text (the images stay for a retry). */
export async function postCommentAction(ticket: number, body: string, mediaIds: number[]): Promise<{ images: string[] } | { error: string }> {
  const { user, payload, workspaceId } = await acting()
  try {
    return { images: await postComment(payload, user, { ticket, workspaceId, body, mediaIds }) }
  } catch (e) {
    if (e instanceof NotInWorkspace) notFound()
    return { error: e instanceof CommentRefused ? e.message : 'The forge did not accept the comment. Your images are kept; try again.' }
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
  const repair: Repair | null = kind === 'stage' && (REPAIR_STAGES as readonly string[]).includes(stage) ? { kind, stage: stage as (typeof REPAIR_STAGES)[number] } : kind === 'clear-waiting' || kind === 'reset-counters' || kind === 'rank-top' ? { kind } : null
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
