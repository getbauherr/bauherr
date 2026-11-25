import type { Payload } from 'payload'
import { loadRows, type TicketRow } from '../../../core/views/rows'
import { notFound } from 'next/navigation'
import { assignmentRows, isProductOwner } from '../../../lib/people'
import { requirePerson } from './session'

export type OwnedProduct = { id: number; name: string; workspace: number; requests: TicketRow[] }

const ids = (list: number[]) => ({ in: list.length ? list : [0] })

export const productsOf = async (payload: Payload, assignments: unknown): Promise<OwnedProduct[]> => {
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
  const now = new Date()
  return Promise.all(
    found
      .flat()
      .map(async (p) => ({ ...p, requests: await loadRows(payload, { workspace: p.workspace, product: p.id, now }) })),
  )
}

export const requireProductOwner = async () => {
  const person = await requirePerson()
  return isProductOwner(person) ? person : notFound()
}
