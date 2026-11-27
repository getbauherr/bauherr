import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { loadRows, type TicketRow } from '../../../core/views/rows'
import { requestCounts, requestPage, type RequestCursor } from '../../../core/views/request-list'
import { listRequests, type RequestFilter, type Viewer } from '../../../core/views/request-status'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { REQUEST_PAGE } from './chunks'
import { assignmentRows, isBauherr, isProductOwner, loginsOf, mayWorkIn } from '../../../lib/people'
import { currentPersonWorkspace, requirePerson, type Person } from './session'

export const REQUEST_PRODUCT_COOKIE = 'bauherr-request-product'

export type OwnedProduct = { id: number; name: string; workspace: number; requests: TicketRow[] }

const ids = (list: number[]) => ({ in: list.length ? list : [0] })

export type ListedProduct = Omit<OwnedProduct, 'requests'>

const productsIn = async (payload: Payload, assignments: unknown): Promise<ListedProduct[]> => {
  const rows = assignmentRows(assignments)
  const found = await Promise.all(
    rows.map(async (r) => {
      const { docs } = await payload.find({
        collection: 'products',
        where: {
          and: [{ workspace: { equals: r.workspace } }, ...(r.scope === 'workspace' ? [] : [{ id: ids(r.products) }])],
        },
        sort: 'name',
        pagination: false,
        depth: 0,
        overrideAccess: true,
      })
      return docs.map((p) => ({ id: Number(p.id), name: String(p.name), workspace: r.workspace }))
    }),
  )
  return found.flat()
}

export const productsOf = async (payload: Payload, assignments: unknown): Promise<OwnedProduct[]> => {
  const now = new Date()
  return Promise.all(
    (await productsIn(payload, assignments)).map(async (p) => ({
      ...p,
      requests: await loadRows(payload, { workspace: p.workspace, product: p.id, now }),
    })),
  )
}

export const readableProducts = async (payload: Payload, person: Person): Promise<ListedProduct[]> => {
  if (isProductOwner(person)) return productsIn(payload, person.assignments)
  const { workspace } = await currentPersonWorkspace()
  return workspace && mayWorkIn(person, workspace.id)
    ? productsIn(payload, [{ workspace: workspace.id, scope: 'workspace' }])
    : []
}

const requestFilter = (product: ListedProduct) =>
  ({ workspace: product.workspace, product: product.id, now: new Date(), history: 'all' }) as const

export const viewerOf = async (payload: Payload, person: Person): Promise<Viewer> => ({
  forgeLogins: loginsOf(person.githubLogin),
  sentRecordIds: await sentRecordIdsOf(payload, person.email),
})

export const requestChunk = async (
  payload: Payload,
  input: { product: ListedProduct; viewer: Viewer; show: RequestFilter; after: RequestCursor | null; limit?: number },
) => {
  const limit = input.limit ?? REQUEST_PAGE
  const page = await requestPage(payload, requestFilter(input.product), { ...input, limit })
  return { list: listRequests(page.rows, input.viewer), cursor: page.cursor }
}

export const requestTotals = (payload: Payload, product: ListedProduct, viewer: Viewer) =>
  requestCounts(payload, requestFilter(product), viewer)

export const sentRecordIdsOf = async (payload: Payload, email: string): Promise<number[]> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "record_id" FROM "request_drafts" WHERE "created_by" = ${email} AND "record_id" IS NOT NULL`,
  )
  return found.rows.map((r) => Number(r.record_id))
}

export const requireRequestsReader = async (): Promise<Person> => {
  const person = await requirePerson()
  return isProductOwner(person) || isBauherr(person) ? person : notFound()
}

export const requireProductOwner = async () => {
  const person = await requirePerson()
  return isProductOwner(person) ? person : notFound()
}

export const chosenProduct = async <T extends { id: number }>(products: T[], asked: string | undefined) => {
  const remembered = (await cookies()).get(REQUEST_PRODUCT_COOKIE)?.value
  const match = (value: string | undefined) => products.find((p) => String(p.id) === value)
  return match(asked) ?? match(remembered) ?? products[0]
}
