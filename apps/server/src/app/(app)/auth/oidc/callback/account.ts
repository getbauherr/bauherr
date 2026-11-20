import { randomBytes } from 'node:crypto'
import type { Payload, Where } from 'payload'
import { roleRequired, resolveAccount, syncFrom } from '../../../../../lib/oidc'
import { resyncRole } from '../../../../../lib/people'

const o = { overrideAccess: true, depth: 0 } as const

type Account = { id: number | string; role?: string; sessionVersion?: number }
export type SignedIn = { refused: 'oidc-link' | 'oidc-role' } | { user: Account }

const findAccount = async (payload: Payload, where: Where): Promise<Account | undefined> =>
  (await payload.find({ collection: 'bauherren', where, limit: 1, ...o })).docs[0]

const tenantsFor = async (payload: Payload, slugs: string[] | undefined) => {
  if (!slugs) return undefined
  if (!slugs.length) return []
  const { docs } = await payload.find({
    collection: 'workspaces',
    where: { slug: { in: slugs } },
    pagination: false,
    ...o,
  })
  return docs.map((w) => ({ tenant: w.id }))
}

const withoutRequiredRole = async (payload: Payload, bySubject: Account | undefined): Promise<SignedIn> => {
  if (bySubject)
    await payload.update({
      collection: 'bauherren',
      id: bySubject.id,
      data: { sessionVersion: (bySubject.sessionVersion ?? 0) + 1 },
      ...o,
    })
  payload.logger.warn('oidc_login_refused')
  return { refused: 'oidc-role' }
}

export const signInAccount = async (payload: Payload, claims: Record<string, unknown>): Promise<SignedIn> => {
  const email = (claims.email as string).toLowerCase()
  const subject = `${String(claims.iss)}|${String(claims.sub)}`
  const bySubject = await findAccount(payload, { oidcSubject: { equals: subject } })
  const byEmail = bySubject ? undefined : await findAccount(payload, { email: { equals: email } })
  const { action } = resolveAccount({ subject, email, existingBySubject: bySubject, existingByEmail: byEmail })
  if (action === 'refuse') return { refused: 'oidc-link' }
  const sync = syncFrom(claims)
  if (roleRequired() && !sync.role) return withoutRequiredRole(payload, bySubject)
  const tenants = await tenantsFor(payload, sync.slugs)
  const data = {
    ...(sync.role && { role: resyncRole(bySubject?.role, sync.role) }),
    ...(tenants && { tenants }),
    oidcSubject: subject,
    oidcSynced: new Date().toISOString(),
  }
  const user = bySubject
    ? await payload.update({ collection: 'bauherren', id: bySubject.id, data, ...o })
    : await payload.create({
        collection: 'bauherren',
        data: { ...data, email, password: randomBytes(32).toString('hex') },
        context: { oidc: true },
        ...o,
      })
  return { user }
}
