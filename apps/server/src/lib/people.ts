import type { Where } from 'payload'

type Doc = Record<string, any>

export const ROLES = ['admin', 'bauherr', 'product-owner'] as const
export type Role = (typeof ROLES)[number]
export type Assignment = { scope: 'workspace' } | { scope: 'products'; products: number[] }

const RANK: Record<string, number> = { admin: 3, bauherr: 2, 'product-owner': 1 }
const id = (v: unknown): number | undefined => {
  const n = Number(v && typeof v === 'object' ? (v as Doc).id : v)
  return Number.isFinite(n) && v != null && v !== '' ? n : undefined
}

/** Admin > Bauherr > Product owner; anything else (no user, an unknown role) ranks 0 and is refused everywhere. */
export const rank = (user: Doc | null | undefined): number => RANK[user?.role as string] ?? 0
/** Admin or Bauherr: the factory's own people. */
export const isBauherr = (user: Doc | null | undefined): boolean => rank(user) >= RANK.bauherr
export const isProductOwner = (user: Doc | null | undefined): boolean => user?.role === 'product-owner'

/** Where a person lands after sign-in: a Product owner on Requests, everyone else on the Workflow. */
export const homeOf = (user: Doc | null | undefined): string => (isProductOwner(user) ? '/requests' : '/')

/** The Workspace ids of the account's `tenants` rows. */
export const tenantIds = (user: Doc): number[] => ((user.tenants as { tenant: unknown }[] | undefined) ?? []).flatMap((t) => id(t.tenant) ?? [])

/** What a Product owner may see in a Workspace; null for anyone else and for a Workspace without an assignment. An empty product list grants nothing. */
export const assignmentOf = (user: Doc, workspace: number | string): Assignment | null => {
  if (!isProductOwner(user)) return null
  const row = ((user.assignments as Doc[] | undefined) ?? []).find((a) => id(a.workspace) === Number(workspace))
  if (!row) return null
  return row.scope === 'workspace' ? { scope: 'workspace' } : row.scope === 'products' ? { scope: 'products', products: ((row.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []) } : null
}

/** Bauherren and Admins see every Product of their Workspaces (an Admin of all); a Product owner only what the assignment names. */
export const canSeeProduct = (user: Doc, product: { id: number | string; workspace: unknown }): boolean => {
  const ws = id(product.workspace)
  if (ws === undefined) return false
  if (user.role === 'admin') return true
  if (user.role === 'bauherr') return tenantIds(user).includes(ws)
  const a = assignmentOf(user, ws)
  return a?.scope === 'workspace' || (a?.scope === 'products' && a.products.includes(Number(product.id)))
}

const NOTHING = { equals: -1 } as const

/** The ONE filter of "which Products of a Workspace may this person see" for a collection with a `field` relation to products (Bauherr/Admin: the Workspace; Product owner: the assignment; anyone else: nothing). */
export const productScope = (user: Doc, workspace: number | string, field = 'product'): Where => {
  const ws = Number(workspace)
  if (isBauherr(user)) return { [`${field}.workspace`]: { equals: ws } }
  const a = assignmentOf(user, ws)
  if (a?.scope === 'workspace') return { [`${field}.workspace`]: { equals: ws } }
  return { [field]: a?.scope === 'products' && a.products.length ? { in: a.products } : NOTHING }
}

/** The products of a Workspace this person may see, as a `where` on the `products` collection. */
export const productsVisibleTo = (user: Doc, workspace: number | string): Where => {
  const a = assignmentOf(user, workspace)
  return { and: [{ workspace: { equals: Number(workspace) } }, ...(isBauherr(user) || a?.scope === 'workspace' ? [] : [{ id: a?.scope === 'products' && a.products.length ? { in: a.products } : NOTHING }])] }
}

/** Which requests of a Workspace a person sees: Bauherren and Admins all, a Product owner those of their Products that were sent, plus their own drafts. */
export const requestsVisibleTo = (user: Doc, workspace: number | string): Where => ({
  and: [productScope(user, workspace), ...(isProductOwner(user) ? [{ or: [{ status: { equals: 'submitted' } }, { user: { equals: user.id } }] }] : [])],
})

/** Whether a stored file (a media row read at depth 1) may be served to this person: it belongs to a Product they see, and a request draft's files only to its author. */
export const mediaVisibleTo = (user: Doc, m: Doc): boolean => {
  const s = m.session && typeof m.session === 'object' ? m.session : null
  const workspace = id(s?.workspace ?? m.workspace)
  const product = id(s?.product ?? m.product)
  if (workspace === undefined || product === undefined || !canSeeProduct(user, { id: product, workspace })) return false
  return !(isProductOwner(user) && s && s.status !== 'submitted' && id(s.user) !== Number(user.id))
}

export type AssignmentRow = { workspace: number; scope: 'workspace' | 'products'; products: number[] }

/** Assignment rows as stored (ids, populated docs, empty `products` under `workspace`). */
export const assignmentRows = (raw: unknown): AssignmentRow[] =>
  ((raw as Doc[] | undefined) ?? []).flatMap((a) => {
    const workspace = id(a.workspace)
    if (workspace === undefined) return []
    const scope = a.scope === 'workspace' ? 'workspace' : 'products'
    return [{ workspace, scope, products: scope === 'workspace' ? [] : ((a.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []) }]
  })

/** The first rule of the role field on a re-sync: a Product owner is raised only by an Admin or an admin claim, never by the claim's default `bauherr`. */
export const resyncRole = (stored: string | undefined, claimed: Role): Role => (stored === 'product-owner' && claimed === 'bauherr' ? 'product-owner' : claimed)

/** The words of an assignment for the People table, e.g. "All Products of Acme" or "Acme Shop, Acme Web". */
export const assignmentWords = (rows: { workspace: string; scope: 'workspace' | 'products'; products: string[] }[]): string =>
  rows.length ? rows.map((r) => (r.scope === 'workspace' ? `All Products of ${r.workspace}` : r.products.join(', ') || `No Products in ${r.workspace}`)).join('; ') : 'Nothing assigned'
