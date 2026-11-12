import config from '@payload-config'
import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload, type TypedUser } from 'payload'
import { cache } from 'react'
import { loadWorkflows } from '../../../lib/factory'
import { isBauherr, isProductOwner, type Role } from '../../../lib/people'

export type Workspace = { id: number; name: string; slug: string; knowledgeRepo?: string | null; knowledgeConnection?: unknown }
export type Person = TypedUser & { email: string; role: Role; uiPrefs?: { epic?: number | null } | null; tenants?: { tenant: Workspace | number | null }[]; assignments?: unknown[] }
export type Bauherr = Person & { role: 'admin' | 'bauherr' }

export const WS_COOKIE = 'bauherr-ws'

export const payloadClient = async () => {
  const payload = await getPayload({ config })
  await loadWorkflows(payload)
  return payload
}

/** The signed-in account of any role: a Product owner too. Use it only where a page or action is open to both. */
export const getPerson = cache(async (): Promise<Person | null> => {
  const { user } = await (await payloadClient()).auth({ headers: await headers() })
  return user as Person | null
})

export const requirePerson = async (): Promise<Person> => (await getPerson()) ?? redirect('/login')

/** The signed-in Admin or Bauherr; null for a Product owner, whose every page, action and route built on this stays closed. */
export const getBauherr = cache(async (): Promise<Bauherr | null> => {
  const person = await getPerson()
  return isBauherr(person) ? (person as Bauherr) : null
})

/** Redirects to /login without a session; a Product owner gets a 404 (the page does not exist for them). */
export const requireBauherr = async (): Promise<Bauherr> => {
  const person = await requirePerson()
  return isProductOwner(person) || !isBauherr(person) ? notFound() : (person as Bauherr)
}

/** Remembers (or with null clears) the Board/Runs epic filter of the acting Bauherr. */
export const rememberEpic = async (user: Bauherr, epic: number | null): Promise<void> => {
  await (await payloadClient()).update({ collection: 'bauherren', id: user.id, data: { uiPrefs: { ...user.uiPrefs, epic } }, overrideAccess: true, depth: 0 })
}

/** Admin: all Workspaces; otherwise those in the Bauherr's `tenants`. */
export const workspacesOf = cache(async (user: Bauherr): Promise<Workspace[]> => {
  const payload = await payloadClient()
  const ids = (user.tenants ?? []).map((t) => (typeof t.tenant === 'object' ? t.tenant?.id : t.tenant)).filter((id) => id != null)
  if (user.role !== 'admin' && !ids.length) return []
  const { docs } = await payload.find({
    collection: 'workspaces',
    where: user.role === 'admin' ? {} : { id: { in: ids } },
    sort: 'name',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  return docs as unknown as Workspace[]
})

/** Selected Workspace (cookie slug), falling back to the first; null when the Bauherr has none. */
export const currentWorkspace = async (): Promise<{ user: Bauherr; workspace: Workspace | null; workspaces: Workspace[] }> => {
  const user = await requireBauherr()
  const workspaces = await workspacesOf(user)
  const slug = (await cookies()).get(WS_COOKIE)?.value
  return { user, workspaces, workspace: workspaces.find((w) => w.slug === slug) ?? workspaces[0] ?? null }
}
