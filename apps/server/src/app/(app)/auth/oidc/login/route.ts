import { NextResponse } from 'next/server'
import { beginLogin, OIDC_COOKIE, oidcEnabled, publicUrl } from '../../../../../lib/oidc'

export const GET = async () => {
  if (!oidcEnabled()) return new NextResponse(null, { status: 404 })
  try {
    const { url, tx } = await beginLogin()
    const res = NextResponse.redirect(url)
    res.cookies.set(OIDC_COOKIE, JSON.stringify(tx), { httpOnly: true, sameSite: 'lax', secure: publicUrl().startsWith('https:'), path: '/auth/oidc', maxAge: 600 })
    return res
  } catch {
    return NextResponse.redirect(new URL('/login?error=oidc', publicUrl()))
  }
}
