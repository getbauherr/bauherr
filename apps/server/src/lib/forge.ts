import type { Payload, PayloadRequest } from 'payload'
import { backendFor } from './adapters'
import { connectionInput, webOrigin } from './connection'

const o = { overrideAccess: true, depth: 0 } as const

export const forgeOf = async (payload: Payload, product: number | string, req?: Partial<PayloadRequest>) => {
  const src = (await payload.find({ collection: 'ticket_sources', where: { product: { equals: product } }, limit: 1, ...o, req })).docs[0]
  if (!src) throw new Error('no ticket source for this Product')
  const connection = await connectionInput(payload, src.connection, req)
  const backend = backendFor(connection)
  return { backend, repo: src.repo as string, web: webOrigin(connection), tickets: backend.tickets(src.repo), kind: connection.kind === 'gitlab' ? ('gitlab' as const) : ('github' as const) }
}
