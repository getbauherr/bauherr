import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { beginLogin, OIDC_COOKIE, oidcEnabled, publicUrl, warnIfMisconfigured } from '../../../../../lib/oidc'

export const GET = async () => {
  const payload = await getPayload({ config })
  if (!oidcEnabled()) {
    warnIfMisconfigured(payload.logger)
    return new NextResponse(null, { status: 404 })
  }
  try {
    const { url, tx } = await beginLogin()
    const res = NextResponse.redirect(url)
    res.cookies.set(OIDC_COOKIE, JSON.stringify(tx), { httpOnly: true, sameSite: 'lax', secure: publicUrl().startsWith('https:'), path: '/auth/oidc', maxAge: 600 })
    return res
  } catch (e) {
    payload.logger.error(`oidc_login_failed ${(e as Error).name}: ${(e as Error).message}`)
    return NextResponse.redirect(new URL('/login?error=oidc', publicUrl()))
  }
}
