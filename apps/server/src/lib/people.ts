type Doc = Record<string, any>

export const ROLES = ['admin', 'bauherr', 'product-owner'] as const
export type Role = (typeof ROLES)[number]
export type Assignment = { scope: 'workspace' } | { scope: 'products'; products: number[] }

const RANK: Record<string, number> = { admin: 3, bauherr: 2, 'product-owner': 1 }
const id = (v: unknown): number | undefined => {
  const n = Number(v && typeof v === 'object' ? (v as Doc).id : v)
  return Number.isFinite(n) && v != null && v !== '' ? n : undefined
}

export const isBauherr = (user: Doc | null | undefined): boolean => (RANK[user?.role as string] ?? 0) >= RANK.bauherr
export const isProductOwner = (user: Doc | null | undefined): boolean => user?.role === 'product-owner'

export const tenantIds = (user: Doc): number[] => ((user.tenants as { tenant: unknown }[] | undefined) ?? []).flatMap((t) => id(t.tenant) ?? [])

export const assignmentOf = (user: Doc, workspace: number | string): Assignment | null => {
  if (!isProductOwner(user)) return null
  const row = ((user.assignments as Doc[] | undefined) ?? []).find((a) => id(a.workspace) === Number(workspace))
  if (!row) return null
  return row.scope === 'workspace' ? { scope: 'workspace' } : row.scope === 'products' ? { scope: 'products', products: ((row.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []) } : null
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
