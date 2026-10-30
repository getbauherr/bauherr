import config from '@payload-config'
import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'
import { finishLogin, OIDC_COOKIE, oidcEnabled, publicUrl, roleFrom, workspaceSlugsFrom, type OidcTransaction } from '../../../../../lib/oidc'
import { SESSION_COOKIE, SESSION_TTL_S, signSession } from '../../../../../lib/oidc-session'

const o = { overrideAccess: true, depth: 0 } as const

export const GET = async (req: NextRequest) => {
  const fail = () => {
    const res = NextResponse.redirect(new URL('/login?error=oidc', publicUrl()))
    res.cookies.delete({ name: OIDC_COOKIE, path: '/auth/oidc' })
    return res
  }
  if (!oidcEnabled()) return new NextResponse(null, { status: 404 })
  try {
    const tx = JSON.parse(req.cookies.get(OIDC_COOKIE)?.value ?? '') as OidcTransaction
    const current = new URL(req.nextUrl.pathname + req.nextUrl.search, publicUrl())
    const claims = await finishLogin(current, tx)
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
    if (!email || claims.email_verified === false) return fail()

    const payload = await getPayload({ config })
    const subject = `${claims.iss}|${claims.sub}`
    const slugs = workspaceSlugsFrom(claims)
    const tenants = slugs.length
      ? (await payload.find({ collection: 'workspaces', where: { slug: { in: slugs } }, pagination: false, ...o })).docs.map((w) => ({ tenant: w.id }))
      : []
    const data = { role: roleFrom(claims), tenants, oidcSubject: subject, oidcSynced: new Date().toISOString() }

    const existing = (await payload.find({ collection: 'bauherren', where: { email: { equals: email } }, limit: 1, ...o })).docs[0]
    if (existing?.oidcSubject && existing.oidcSubject !== subject) return fail()
    const user = existing
      ? await payload.update({ collection: 'bauherren', id: existing.id, data, ...o })
      : await payload.create({ collection: 'bauherren', data: { ...data, email, password: randomBytes(32).toString('hex') }, ...o })

    const res = NextResponse.redirect(new URL('/', publicUrl()))
    res.cookies.delete({ name: OIDC_COOKIE, path: '/auth/oidc' })
    res.cookies.set(SESSION_COOKIE, signSession(user.id), { httpOnly: true, sameSite: 'lax', secure: publicUrl().startsWith('https:'), path: '/', maxAge: SESSION_TTL_S })
    return res
  } catch {
    return fail()
  }
}
