import config from '@payload-config'
import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload, type Where } from 'payload'
import { emailOk, finishLogin, OIDC_COOKIE, oidcEnabled, publicUrl, resolveAccount, syncFrom, warnIfMisconfigured, type OidcTransaction } from '../../../../../lib/oidc'
import { SESSION_COOKIE, SESSION_TTL_S, signSession } from '../../../../../lib/oidc-session'

const o = { overrideAccess: true, depth: 0 } as const

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

    const email = (claims.email as string).toLowerCase()
    const subject = `${claims.iss}|${claims.sub}`
    const find = async (where: Where) => (await payload.find({ collection: 'bauherren', where, limit: 1, ...o })).docs[0]
    const bySubject = await find({ oidcSubject: { equals: subject } })
    const byEmail = bySubject ? undefined : await find({ email: { equals: email } })
    const { action } = resolveAccount({ subject, email, existingBySubject: bySubject, existingByEmail: byEmail })
    if (action === 'refuse') return fail('oidc-link')

    const sync = syncFrom(claims)
    const tenants = sync.slugs
      ? sync.slugs.length
        ? (await payload.find({ collection: 'workspaces', where: { slug: { in: sync.slugs } }, pagination: false, ...o })).docs.map((w) => ({ tenant: w.id }))
        : []
      : undefined
    const data = { ...(sync.role && { role: sync.role }), ...(tenants && { tenants }), oidcSubject: subject, oidcSynced: new Date().toISOString() }

    const user = bySubject
      ? await payload.update({ collection: 'bauherren', id: bySubject.id, data, ...o })
      : await payload.create({ collection: 'bauherren', data: { ...data, email, password: randomBytes(32).toString('hex') }, context: { oidc: true }, ...o })

    const res = NextResponse.redirect(new URL('/', publicUrl()))
    res.cookies.delete({ name: OIDC_COOKIE, path: '/auth/oidc' })
    res.cookies.set(SESSION_COOKIE, signSession(user.id, user.sessionVersion ?? 0), { httpOnly: true, sameSite: 'lax', secure: publicUrl().startsWith('https:'), path: '/', maxAge: SESSION_TTL_S })
    return res
  } catch (e) {
    payload.logger.error(`oidc_callback_failed ${(e as Error).name}: ${(e as Error).message}`)
    return fail()
  }
}
