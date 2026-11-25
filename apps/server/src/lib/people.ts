type Doc = object
type Row = { id?: unknown; workspace?: unknown; scope?: unknown; products?: unknown }

export const ROLES = ['admin', 'bauherr', 'product-owner'] as const
export type Role = (typeof ROLES)[number]
export type Assignment = { scope: 'workspace' } | { scope: 'products'; products: number[] }

const field = (doc: Doc, name: string): unknown => (doc as Record<string, unknown>)[name]

const RANK: Record<Role, number> = { admin: 3, bauherr: 2, 'product-owner': 1 }
const id = (v: unknown): number | undefined => {
  const n = Number(v && typeof v === 'object' ? (v as Row).id : v)
  return Number.isFinite(n) && v != null && v !== '' ? n : undefined
}

export const loginsOf = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)

export const isBauherr = (user: Doc | null | undefined): boolean => {
  const role = ROLES.find((r) => r === (user && field(user, 'role')))
  return role !== undefined && RANK[role] >= RANK.bauherr
}
export const isProductOwner = (user: Doc | null | undefined): boolean =>
  !!user && field(user, 'role') === 'product-owner'

export const tenantIds = (user: Doc): number[] =>
  ((field(user, 'tenants') as { tenant: unknown }[] | undefined) ?? []).flatMap((t) => id(t.tenant) ?? [])

export const mayWorkIn = (user: Doc, workspace: number): boolean =>
  field(user, 'role') === 'admin' || tenantIds(user).includes(workspace)

export const assignmentOf = (user: Doc, workspace: number | string): Assignment | null => {
  if (!isProductOwner(user)) return null
  const row = ((field(user, 'assignments') as Row[] | undefined) ?? []).find(
    (a) => id(a.workspace) === Number(workspace),
  )
  if (!row) return null
  return row.scope === 'workspace'
    ? { scope: 'workspace' }
    : row.scope === 'products'
      ? { scope: 'products', products: ((row.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []) }
      : null
}

export type AssignmentRow = { workspace: number; scope: 'workspace' | 'products'; products: number[] }

export const assignmentRows = (raw: unknown): AssignmentRow[] =>
  ((raw as Row[] | undefined) ?? []).flatMap((a) => {
    const workspace = id(a.workspace)
    if (workspace === undefined) return []
    const scope = a.scope === 'workspace' ? 'workspace' : 'products'
    return [
      {
        workspace,
        scope,
        products: scope === 'workspace' ? [] : ((a.products as unknown[]) ?? []).flatMap((p) => id(p) ?? []),
      },
    ]
  })

export const resyncRole = (stored: string | undefined, claimed: Role): Role =>
  stored === 'product-owner' ? 'product-owner' : claimed

export const assignmentWords = (
  rows: { workspace: string; scope: 'workspace' | 'products'; products: string[] }[],
): string =>
  rows.length
    ? rows
        .map((r) =>
          r.scope === 'workspace'
            ? `All Products of ${r.workspace}`
            : r.products.join(', ') || `No Products in ${r.workspace}`,
        )
        .join('; ')
    : 'Nothing assigned'
