import type { Payload, Where } from 'payload'

const count = async (payload: Payload, collection: string, where: Where) =>
  (await payload.count({ collection, where, overrideAccess: true })).totalDocs
const why = (parts: [number, string][]) =>
  parts
    .filter(([n]) => n)
    .map(([n, s]) => `${n} ${s}`)
    .join(', ')

const PRODUCT_REFS = [
  ['repositories', 'repositories'],
  ['ticket_sources', 'ticket sources'],
] as const

export async function blockedBy(payload: Payload, collection: 'products' | 'connections', id: number): Promise<string> {
  if (collection === 'connections')
    return why([[await count(payload, 'ticket_sources', { connection: { equals: id } }), 'ticket sources']])
  const byProduct = { product: { equals: id } }
  return why(
    await Promise.all(
      PRODUCT_REFS.map(async ([c, label]) => [await count(payload, c, byProduct), label] as [number, string]),
    ),
  )
}

export const recordCountOf = (payload: Payload, product: number): Promise<number> =>
  count(payload, 'records', { product: { equals: product } })

export const ticketsMessage = (tickets: number): string =>
  `This Product has ${tickets} ${tickets === 1 ? 'ticket' : 'tickets'} and cannot be deleted.`

export async function assertNoTickets(payload: Payload, product: number): Promise<void> {
  const tickets = await recordCountOf(payload, product)
  if (tickets) throw new Error(ticketsMessage(tickets))
}

export async function assertInWorkspace(
  payload: Payload,
  collection: string,
  ids: (number | undefined)[],
  workspace: number,
): Promise<void> {
  const wanted = [...new Set(ids.filter((i): i is number => i != null))]
  if (!wanted.length) return
  if ((await count(payload, collection, { id: { in: wanted }, workspace: { equals: workspace } })) !== wanted.length)
    throw new Error('Not in this Workspace')
}

export async function assertAnotherAdmin(payload: Payload, id: number): Promise<void> {
  if (!(await count(payload, 'bauherren', { role: { equals: 'admin' }, id: { not_equals: id } })))
    throw new Error('Add another Admin first')
}
