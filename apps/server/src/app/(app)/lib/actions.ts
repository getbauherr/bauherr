'use server'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { generatePayloadCookie } from 'payload'
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
  const h = await headers()
  const payload = await payloadClient()
  await fetch(`${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}/api/bauherren/logout`, { method: 'POST', headers: { cookie: h.get('cookie') ?? '' } })
  ;(await cookies()).delete(`${payload.config.cookiePrefix}-token`)
  redirect('/login')
}

export async function selectWorkspace(slug: string) {
  if ((await workspacesOf(await requireBauherr())).some((w) => w.slug === slug)) {
    ;(await cookies()).set(WS_COOKIE, slug, { path: '/', sameSite: 'lax', maxAge: 31536000 })
  }
  redirect('/')
}
