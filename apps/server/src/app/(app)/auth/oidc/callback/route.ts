import config from '@payload-config'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'
import {
  emailOk,
  finishLogin,
  OIDC_COOKIE,
  oidcEnabled,
  publicUrl,
  warnIfMisconfigured,
  type OidcTransaction,
} from '../../../../../lib/oidc'
import { SESSION_COOKIE, SESSION_TTL_S, signSession } from '../../../../../lib/oidc-session'
import { signInAccount } from './account'

const sessionRedirect = (user: { id: number | string; sessionVersion?: number }) => {
  const res = NextResponse.redirect(new URL('/', publicUrl()))
  res.cookies.delete({ name: OIDC_COOKIE, path: '/auth/oidc' })
  res.cookies.set(SESSION_COOKIE, signSession(user.id, user.sessionVersion ?? 0), {
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl().startsWith('https:'),
    path: '/',
    maxAge: SESSION_TTL_S,
  })
  return res
}

export const GET = async (req: NextRequest) => {
  const payload = await getPayload({ config })
  const fail = (code = 'oidc') => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, publicUrl()))
    res.cookies.delete({ name: OIDC_COOKIE, path: '/auth/oidc' })
    return res
  }
  if (!oidcEnabled()) {
    warnIfMisconfigured(payload.logger)
    return new NextResponse(null, { status: 404 })
  }
  try {
    const tx = JSON.parse(req.cookies.get(OIDC_COOKIE)?.value ?? '') as OidcTransaction
    const current = new URL(req.nextUrl.pathname + req.nextUrl.search, publicUrl())
    const claims = await finishLogin(current, tx)
    if (!emailOk(claims)) return fail()
    const signedIn = await signInAccount(payload, claims)
    return 'refused' in signedIn ? fail(signedIn.refused) : sessionRedirect(signedIn.user)
  } catch (e) {
    payload.logger.error(`oidc_callback_failed ${(e as Error).name}: ${(e as Error).message}`)
    return fail()
  }
}
