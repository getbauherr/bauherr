import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { startRunIfNeeded } from '../jobs'
import { upsertTicket } from './actions'
import { forgeOf, id } from './release'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** Label of the one long-lived anchor Ticket per Product; the triage stage excludes it. */
export const SECURITY_SCAN_LABEL = 'bauherr:security-scan'

/** The Product's anchor Ticket, created on first use (forge issue and local row). */
export const anchorTicket = async (payload: Payload, product: Doc, req?: Partial<PayloadRequest>): Promise<Doc & { id: number | string }> => {
  const existing = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product.id } }, { labels: { equals: SECURITY_SCAN_LABEL } }] }, limit: 1, ...o, req })).docs[0]
  if (existing) return existing as Doc & { id: number | string }
  const issue = await (await forgeOf(payload, product.id, req)).tickets.create({
    title: `Security scans: ${product.name}`,
    body: 'Anchor Ticket of the security scan Runs for this Product. Bauherr keeps it open; findings are filed as separate Tickets.',
    labels: [SECURITY_SCAN_LABEL],
  })
  return upsertTicket(payload, { workspace: id(product.workspace), product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: 'open', labels: issue.labels }, null, req)
}

const SCAN_LOCK = 464

/**
 * Starts a scan Run (always autonomous) on the Product's anchor Ticket unless one is active and records `lastScanAt` for a new one.
 * Runs in one transaction under a per-Product advisory lock taken on that transaction's connection, with every read and write on the same connection (a waiter holds one pooled connection and the holder needs no second one),
 * so a tick and a manual start cannot both create the anchor Ticket.
 */
export const startSecurityScan = async (payload: Payload, productId: number | string): Promise<{ run: Doc; created: boolean }> => {
  const req = await createLocalReq({}, payload)
  const tx = await payload.db.beginTransaction()
  if (!tx) throw new Error('database transactions unavailable')
  req.transactionID = tx
  try {
    const db = payload.db as unknown as { sessions: Record<string, { db: { execute: (q: unknown) => Promise<unknown> } }> }
    await db.sessions[await tx]!.db.execute(sql`SELECT pg_advisory_xact_lock(${SCAN_LOCK}::int, ${Number(productId)}::int)`)
    const product = (await payload.findByID({ collection: 'products', id: productId, ...o, req })) as Doc
    const started = await startRunIfNeeded(payload, await anchorTicket(payload, product, req), 'scan', {}, req)
    if (started.created) await payload.update({ collection: 'products', id: product.id, data: { securityScan: { ...product.securityScan, lastScanAt: new Date().toISOString() } }, ...o, req })
    await payload.db.commitTransaction(tx)
    return started
  } catch (e) {
    await payload.db.rollbackTransaction(tx)
    throw e
  }
}
