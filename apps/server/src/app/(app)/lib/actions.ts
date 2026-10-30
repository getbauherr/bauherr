'use server'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { VIEWS, type View } from './needs-you'
import { payloadClient, WS_COOKIE, workspacesOf, requireBauherr } from './session'

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
  if (user) await logoutOperation({ collection: payload.collections.bauherren, req: await createLocalReq({ user }, payload) }).catch(() => undefined)
  ;(await cookies()).delete(`${payload.config.cookiePrefix}-token`)
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
