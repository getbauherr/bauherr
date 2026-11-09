import type { Payload } from 'payload'
import { startRunIfNeeded } from '../jobs'
import { upsertTicket } from './actions'
import { forgeOf, id } from './release'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** Label of the one long-lived anchor Ticket per Product; the triage stage excludes it. */
export const SECURITY_SCAN_LABEL = 'bauherr:security-scan'

/** The Product's anchor Ticket, created on first use (forge issue and local row). */
export const anchorTicket = async (payload: Payload, product: Doc): Promise<Doc & { id: number | string }> => {
  const existing = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product.id } }, { labels: { equals: SECURITY_SCAN_LABEL } }] }, limit: 1, ...o })).docs[0]
  if (existing) return existing as Doc & { id: number | string }
  const issue = await (await forgeOf(payload, product.id)).tickets.create({
    title: `Security scans: ${product.name}`,
    body: 'Anchor Ticket of the security scan Runs for this Product. Bauherr keeps it open; findings are filed as separate Tickets.',
    labels: [SECURITY_SCAN_LABEL],
  })
  return upsertTicket(payload, { workspace: id(product.workspace), product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: 'open', labels: issue.labels }, null)
}

/** Starts a scan Run on the Product's anchor Ticket unless one is active; `created` says whether it is new. */
export const startSecurityScan = async (payload: Payload, productId: number | string): Promise<{ run: Doc; created: boolean }> => {
  const product = (await payload.findByID({ collection: 'products', id: productId, ...o })) as Doc
  return startRunIfNeeded(payload, await anchorTicket(payload, product), 'scan')
}
