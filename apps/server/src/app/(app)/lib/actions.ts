'use server'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createLocalReq, generatePayloadCookie, logoutOperation } from 'payload'
import { SESSION_COOKIE } from '../../../lib/oidc-session'
import { clientIp, LoginBusy, signInWithPassword } from '../../../lib/login-lock'
import { payloadClient, requirePerson, WS_COOKIE, workspacesOf } from './session'

export async function login(form: FormData) {
  const payload = await payloadClient()
  let token: string | undefined
  const email = String(form.get('email'))
  try {
    const result = await signInWithPassword(payload, email, String(form.get('password')), clientIp(await headers()))
    token = result.token
      } catch (e) {
    if (!(e instanceof LoginBusy) && (e as { status?: number }).status !== 401) throw e
  }
  if (!token) redirect('/login?error=1')
  const cookie = generatePayloadCookie({ collectionAuthConfig: payload.collections.bauherren.config.auth, cookiePrefix: payload.config.cookiePrefix, token, returnCookieAsObject: true })
  ;(await cookies()).set(cookie.name, cookie.value ?? token, { httpOnly: true, path: '/', sameSite: 'lax', secure: cookie.secure, expires: cookie.expires ? new Date(cookie.expires) : undefined })
  redirect('/')
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
  if ((await workspacesOf(await requirePerson())).some((w) => w.slug === slug)) {
    ;(await cookies()).set(WS_COOKIE, slug, { path: '/', sameSite: 'lax', maxAge: 31536000 })
  }
  redirect('/')
}
