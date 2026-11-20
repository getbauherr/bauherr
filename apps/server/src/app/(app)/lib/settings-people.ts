import type { Where } from 'payload'
import { isAdmin } from './settings-admin'
import { payloadClient, workspacesOf, type Bauherr } from './session'

const o = { overrideAccess: true, depth: 0 } as const

type Named = { id: number; name: string }
type BauherrDoc = {
  id: number
  email: string
  role: string
  tenants?: { tenant: Named | number | null }[] | null
  assignments?: { workspace: Named | number; scope: 'workspace' | 'products'; products?: (Named | number)[] }[] | null
  lockUntil?: string | null
  githubLogin?: string | null
  oidcSubject?: string | null
}

const visibleAssignments = (b: BauherrDoc, visible: (workspace: number) => boolean) =>
  (b.assignments ?? []).flatMap((a) =>
    typeof a.workspace === 'object' && a.workspace && visible(a.workspace.id)
      ? [
          {
            workspace: a.workspace,
            scope: a.scope,
            products: (a.products ?? []).flatMap((p) => (typeof p === 'object' ? [p] : [])),
          },
        ]
      : [],
  )

export async function loadBauherren(user: Bauherr, workspace: number | null) {
  const admin = isAdmin(user)
  if (!admin && workspace == null) return []
  const own = admin ? [] : (await workspacesOf(user)).map((w) => w.id)
  const visible = (id: number) => admin || own.includes(id)
  const where: Where = admin ? {} : { 'tenants.tenant': { equals: workspace } }
  const { docs } = await (
    await payloadClient()
  ).find({
    collection: 'bauherren',
    where,
    sort: 'email',
    ...o,
    depth: 1,
    pagination: false,
    showHiddenFields: true,
  })
  return (docs as BauherrDoc[]).map((b) => ({
    id: b.id,
    email: b.email,
    role: b.role,
    workspaces: (b.tenants ?? [])
      .flatMap((t) => (typeof t.tenant === 'object' && t.tenant ? [t.tenant] : []))
      .filter((w) => visible(w.id)),
    assignments: visibleAssignments(b, visible),
    locked: !!b.lockUntil && new Date(b.lockUntil).getTime() > Date.now(),
    githubLogin: b.githubLogin ?? '',
    oidcLinked: !!b.oidcSubject,
    oidcSubject: admin ? (b.oidcSubject ?? '') : '',
  }))
}
