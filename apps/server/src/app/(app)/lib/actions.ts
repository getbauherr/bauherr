'use server'
import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { NotInWorkspace, approvePlan, loadTicket, postDecisions, sourceOf } from '../../../lib/actions'
import { VIEWS, type View } from './needs-you'
import { PLAN_MARKER, latestWith, parseDecisions } from './plan'
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

export async function setView(view: string) {
  if (!VIEWS.includes(view as View)) return
  const user = await requireBauherr()
  const payload = await payloadClient()
  const current = (await payload.findByID({ collection: 'bauherren', id: user.id, depth: 0, overrideAccess: true })) as { uiPrefs?: object | null }
  await payload.update({ collection: 'bauherren', id: user.id, data: { uiPrefs: { ...current.uiPrefs, view } }, depth: 0, overrideAccess: true })
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

/** Answers are re-validated against the live plan Comment: only known rows and listed options are recorded. */
export async function answerDecisions(form: FormData) {
  const ticket = Number(form.get('ticket'))
  const { user, payload, workspaceId } = await acting()
  await inWorkspace(
    (async () => {
      const t = await loadTicket(payload, user, ticket)
      if (String(t.workspace) !== String(workspaceId)) throw new NotInWorkspace()
      const { ts, n } = await sourceOf(payload, t)
      const plan = latestWith(await ts.listComments(n), PLAN_MARKER)?.body ?? ''
      const answers = parseDecisions(plan).flatMap((d) => {
        const answer = form.get(d.id)
        return typeof answer === 'string' && d.options.includes(answer) ? [{ id: d.id, title: d.title, answer }] : []
      })
      if (answers.length) await postDecisions(payload, user, { ticket, workspaceId, answers })
    })(),
  )
  revalidatePath(`/tickets/${ticket}`)
}
