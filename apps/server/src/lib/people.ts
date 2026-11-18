import type { Payload, Where } from 'payload'
import type { Addressee } from './workflow-rules'

type Doc = Record<string, any>

export const ROLES = ['admin', 'bauherr', 'product-owner'] as const
export type Role = (typeof ROLES)[number]
export type Assignment = { scope: 'workspace' } | { scope: 'products'; products: number[] }

const RANK: Record<string, number> = { admin: 3, bauherr: 2, 'product-owner': 1 }
const id = (v: unknown): number | undefined => {
  const n = Number(v && typeof v === 'object' ? (v as Doc).id : v)
  return Number.isFinite(n) && v != null && v !== '' ? n : undefined
}

export const rank = (user: Doc | null | undefined): number => RANK[user?.role as string] ?? 0
export const isBauherr = (user: Doc | null | undefined): boolean => rank(user) >= RANK.bauherr
export const isProductOwner = (user: Doc | null | undefined): boolean => user?.role === 'product-owner'

export const homeOf = (user: Doc | null | undefined): string => (isProductOwner(user) ? '/requests' : '/')

export const tenantIds = (user: Doc): number[] => ((user.tenants as { tenant: unknown }[] | undefined) ?? []).flatMap((t) => id(t.tenant) ?? [])

export const assignmentOf = (user: Doc, workspace: number | string): Assignment | null => {
  if (!isProductOwner(user)) return null
  const row = ((user.assignments as Doc[] | undefined) ?? []).find((a) => id(a.workspace) === Number(workspace))
  if (!row) return null
  return row.scope === 'workspace' ? { scope: 'workspace' } : row.scope === 'products' ? { scope: 'products', products: ((row.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []) } : null
}

export const canSeeProduct = (user: Doc, product: { id: number | string; workspace: unknown }): boolean => {
  const ws = id(product.workspace)
  if (ws === undefined) return false
  if (user.role === 'admin') return true
  if (user.role === 'bauherr') return tenantIds(user).includes(ws)
  const a = assignmentOf(user, ws)
  return a?.scope === 'workspace' || (a?.scope === 'products' && a.products.includes(Number(product.id)))
}

const NOTHING = { equals: -1 } as const

export const productScope = (user: Doc, workspace: number | string, field = 'product'): Where => {
  const ws = Number(workspace)
  if (isBauherr(user)) return { [`${field}.workspace`]: { equals: ws } }
  const a = assignmentOf(user, ws)
  if (a?.scope === 'workspace') return { [`${field}.workspace`]: { equals: ws } }
  return { [field]: a?.scope === 'products' && a.products.length ? { in: a.products } : NOTHING }
}

export const productsVisibleTo = (user: Doc, workspace: number | string): Where => {
  const a = assignmentOf(user, workspace)
  return { and: [{ workspace: { equals: Number(workspace) } }, ...(isBauherr(user) || a?.scope === 'workspace' ? [] : [{ id: a?.scope === 'products' && a.products.length ? { in: a.products } : NOTHING }])] }
}

export const requestsVisibleTo = (user: Doc, workspace: number | string): Where => ({
  and: [productScope(user, workspace), ...(isProductOwner(user) ? [{ or: [{ status: { equals: 'submitted' } }, { user: { equals: user.id } }] }] : [])],
})

export const mediaVisibleTo = (user: Doc, m: Doc): boolean => {
  const s = m.session && typeof m.session === 'object' ? m.session : null
  const workspace = id(s?.workspace ?? m.workspace)
  const product = id(s?.product ?? m.product)
  if (workspace === undefined || product === undefined || !canSeeProduct(user, { id: product, workspace })) return false
  return !(isProductOwner(user) && s && s.status !== 'submitted' && id(s.user) !== Number(user.id))
}

export type AssignmentRow = { workspace: number; scope: 'workspace' | 'products'; products: number[] }

export const assignmentRows = (raw: unknown): AssignmentRow[] =>
  ((raw as Doc[] | undefined) ?? []).flatMap((a) => {
    const workspace = id(a.workspace)
    if (workspace === undefined) return []
    const scope = a.scope === 'workspace' ? 'workspace' : 'products'
    return [{ workspace, scope, products: scope === 'workspace' ? [] : ((a.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []) }]
  })

export const resyncRole = (stored: string | undefined, claimed: Role): Role => (stored === 'product-owner' && claimed === 'bauherr' ? 'product-owner' : claimed)

export const assignmentWords = (rows: { workspace: string; scope: 'workspace' | 'products'; products: string[] }[]): string =>
  rows.length ? rows.map((r) => (r.scope === 'workspace' ? `All Products of ${r.workspace}` : r.products.join(', ') || `No Products in ${r.workspace}`)).join('; ') : 'Nothing assigned'

export const decidingAs = (user: Doc): Addressee => (isProductOwner(user) ? 'product-owner' : 'bauherr')

export const mayDecide = (user: Doc, { ticket, addressee }: { ticket: Doc; addressee: Addressee }): boolean => {
  const product = id(ticket.product)
  if (!user || product === undefined || !canSeeProduct(user, { id: product, workspace: ticket.workspace })) return false
  return isBauherr(user) || (isProductOwner(user) && addressee === 'product-owner')
}

export const productOwnersOf = async (payload: Payload, workspace: number | string): Promise<Doc[]> =>
  (await payload.find({ collection: 'bauherren', where: { and: [{ role: { equals: 'product-owner' } }, { 'assignments.workspace': { equals: Number(workspace) } }] }, pagination: false, depth: 0, overrideAccess: true })).docs as Doc[]

export const ownerAssigned = (owners: Doc[], product: { id: number | string; workspace: unknown }): boolean => owners.some((u) => canSeeProduct(u, product))

export const productOwnersOfTicket = async (payload: Payload, t: Doc): Promise<Doc[]> => {
  const workspace = id(t.workspace)
  const product = id(t.product)
  return workspace === undefined || product === undefined ? [] : (await productOwnersOf(payload, workspace)).filter((u) => canSeeProduct(u, { id: product, workspace }))
}
