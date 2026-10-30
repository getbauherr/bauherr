import config from '@payload-config'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload, type TypedUser } from 'payload'
import { cache } from 'react'

export type Workspace = { id: number; name: string; slug: string }
export type Bauherr = TypedUser & { email: string; role: 'admin' | 'bauherr'; tenants?: { tenant: Workspace | number }[] }

export const WS_COOKIE = 'bauherr-ws'

export const payloadClient = () => getPayload({ config })

export const getBauherr = cache(async (): Promise<Bauherr | null> => {
  const { user } = await (await payloadClient()).auth({ headers: await headers() })
  return user as Bauherr | null
})

export const requireBauherr = async (): Promise<Bauherr> => (await getBauherr()) ?? redirect('/login')

/** Admin: all Workspaces; otherwise those in the Bauherr's `tenants`. */
export const workspacesOf = cache(async (user: Bauherr): Promise<Workspace[]> => {
  const payload = await payloadClient()
  const ids = (user.tenants ?? []).map((t) => (typeof t.tenant === 'object' ? t.tenant.id : t.tenant))
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
