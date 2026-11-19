import config from '@payload-config'
import { cookies, headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getPayload, type TypedUser } from 'payload'
import { cache } from 'react'
import { live } from '../../../lib/workspace-delete'
import { assignmentOf, isBauherr, isProductOwner, type Role } from '../../../lib/people'

export type Workspace = { id: number; name: string; slug: string; knowledgeRepo?: string | null; knowledgeConnection?: unknown }
export type Person = TypedUser & { email: string; role: Role; tenants?: { tenant: Workspace | number | null }[]; assignments?: unknown[] }
export type Bauherr = Person & { role: 'admin' | 'bauherr' }

export const WS_COOKIE = 'bauherr-ws'

export const payloadClient = () => getPayload({ config })

export const getPerson = cache(async (): Promise<Person | null> => {
  const { user } = await (await payloadClient()).auth({ headers: await headers() })
  return user as Person | null
})

export const requirePerson = async (): Promise<Person> => (await getPerson()) ?? redirect('/login')

export const requireBauherr = async (): Promise<Bauherr> => {
  const person = await requirePerson()
  return isProductOwner(person) || !isBauherr(person) ? notFound() : (person as Bauherr)
}

export const workspacesOf = cache(async (user: Person): Promise<Workspace[]> => {
  const payload = await payloadClient()
  const ids = (user.tenants ?? []).map((t) => (typeof t.tenant === 'object' ? t.tenant?.id : t.tenant)).filter((id) => id != null)
  if (user.role !== 'admin' && !ids.length) return []
  const { docs } = await payload.find({
    collection: 'workspaces',
    where: user.role === 'admin' ? live : { and: [live, { id: { in: ids } }] },
    sort: 'name',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  return (docs as unknown as Workspace[]).filter((w) => !isProductOwner(user) || assignmentOf(user, w.id))
})

export const currentWorkspace = async (): Promise<{ user: Bauherr; workspace: Workspace | null; workspaces: Workspace[] }> => {
  const user = await requireBauherr()
  const workspaces = await workspacesOf(user)
  const slug = (await cookies()).get(WS_COOKIE)?.value
  return { user, workspaces, workspace: workspaces.find((w) => w.slug === slug) ?? workspaces[0] ?? null }
}

export const currentPersonWorkspace = async (): Promise<{ user: Person; workspace: Workspace | null; workspaces: Workspace[] }> => {
  const user = await requirePerson()
  if (!isBauherr(user) && !isProductOwner(user)) notFound()
  const workspaces = await workspacesOf(user)
  const slug = (await cookies()).get(WS_COOKIE)?.value
  return { user, workspaces, workspace: workspaces.find((w) => w.slug === slug) ?? workspaces[0] ?? null }
}
