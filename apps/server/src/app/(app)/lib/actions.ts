'use server'
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { NotInWorkspace, NotReleasable, acceptStaging, approvePlan, approveProduction, grantReviewRound, stopReview, rankTicket, releaseLock, requestChanges, loadTicket, postDecisions, personOf, sourceOf, startOwnerIntake, answerOwnerIntake, abandonIntake } from '../../../lib/actions'
import { startRunIfNeeded } from '../../../jobs'
import { RERUNNABLE } from './run'
import { parseDecisions, sheetOf } from './plan'
import { EditRefused, saveDocument } from '../../../lib/knowledge-edit'
import { SESSION_COOKIE } from '../../../lib/oidc-session'
import { currentWorkspace, payloadClient, WS_COOKIE, workspacesOf, requireBauherr } from './session'

export async function login(form: FormData) {
  const payload = await payloadClient()
  let token: string | undefined
  try {
    ;({ token } = await payload.login({
      collection: 'bauherren',
      data: { email: String(form.get('email')), password: String(form.get('password')) },
    }))
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

export async function requestChangesAction(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(requestChanges(payload, user, { ticket, note: String(form.get('note') ?? ''), workspaceId }))
  revalidatePath(`/tickets/${ticket}`)
}

/** Answers are re-validated against the live decision sheet: only known rows and listed options are recorded. */
export async function answerDecisions(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(
    (async () => {
      const t = await loadTicket(payload, user, ticket)
      if (String(t.workspace) !== String(workspaceId)) throw new NotInWorkspace()
      const { ts, n } = await sourceOf(payload, t)
      const sheet = sheetOf(await ts.listComments(n))?.body ?? ''
      const answers = parseDecisions(sheet).flatMap((d) => {
        const answer = form.get(d.id)
        return typeof answer === 'string' && d.options.includes(answer) ? [{ id: d.id, title: d.title, answer }] : []
      })
      if (answers.length) await postDecisions(payload, user, { ticket, workspaceId, answers })
    })(),
  )
  revalidatePath(`/tickets/${ticket}`)
}

/** Discards one of the caller's open request sessions (New request page). */
export async function discardIntake(session: number) {
  const { user, payload } = await acting()
  await inWorkspace(abandonIntake(payload, user, session))
  revalidatePath('/requests/new')
}

/** "Answer interactively": opens an owner Intake session over the Ticket's open decision rows. */
export async function startOwnerChat(ticket: number) {
  const { user, payload, workspaceId } = await acting()
  return inWorkspace(startOwnerIntake(payload, user, { ticket, workspaceId }))
}

export async function answerOwnerChat(session: number, ticket: number, decision: string, answer: string) {
  const { user, payload, workspaceId } = await acting()
  const next = await inWorkspace(answerOwnerIntake(payload, user, { session, decision, answer, workspaceId }))
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

/** Force-releases the lease of a running session Run (Admin or Workspace member); the successor Run is claimable at once. */
export async function releaseRunLock(runId: number) {
  const user = await requireBauherr()
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
