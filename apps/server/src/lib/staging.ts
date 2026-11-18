import type { Payload } from 'payload'
import { gateOn, humanGates, stagingGateOn, type HumanGate } from './mode'
import { ownerAssigned, productOwnersOf } from './people'
import { gates, is, type Workflow } from './workflow'

type Product = { id: number | string; productOwnerTestsStaging?: boolean | null }

export const productGates = async (payload: Payload, wf: Workflow, workspace: number | string, products: Product[]): Promise<(product: unknown) => HumanGate[] | undefined> => {
  if (!gates(wf).staging || gateOn(wf, 'release')) return () => undefined
  const owners = await productOwnersOf(payload, workspace)
  const by = new Map(products.map((p) => [Number(p.id), humanGates(wf, stagingGateOn(wf, p, ownerAssigned(owners, { id: p.id, workspace })))]))
  return (product) => by.get(Number(product && typeof product === 'object' ? (product as { id: unknown }).id : product))
}

export const gatesOf = async (payload: Payload, wf: Workflow, t: Record<string, any>): Promise<HumanGate[] | undefined> => {
  if (!gates(wf).staging || gateOn(wf, 'release') || !is(wf, t.stage ?? '', 'release')) return undefined
  const id = Number(t.product && typeof t.product === 'object' ? (t.product as { id: unknown }).id : t.product)
  const product = (await payload.findByID({ collection: 'products', id, depth: 0, overrideAccess: true })) as Product
  return (await productGates(payload, wf, t.workspace && typeof t.workspace === 'object' ? (t.workspace as { id: number }).id : (t.workspace as number), [product]))(id)
}
