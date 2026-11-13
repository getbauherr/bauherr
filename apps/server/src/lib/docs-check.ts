import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { stageLabel } from '@bauherr/adapters'
import { startRunIfNeeded } from '../jobs'
import { typeLabel, upsertTicket } from './actions'
import { workflowFor } from './factory'
import { forgeOf, id } from './release'
import { scrub } from './security-scan'
import { nameOf } from './workflow'

type Doc = Record<string, any>
const o = { depth: 0, overrideAccess: true } as const

/** Label of the one long-lived anchor Ticket per Product; the triage stage excludes it. */
export const DOCS_CHECK_LABEL = 'bauherr:docs-check'
/** Label of the Ticket a docs check files. */
export const DOCS_LABEL = 'bauherr:docs'
export const DEFAULT_DOCS_PATHS = ['README.md', 'docs/**/*.md']
const FIRST_CHECK_DAYS = 30
const ITEM_CAP = 30
const DOCS_LOCK = 465
const marker = (runId: number | string) => `<!-- bauherr:docs-check:run:${runId} -->`

/** The Product's docs anchor Ticket, created on first use (forge issue and local row). */
const anchorTicket = async (payload: Payload, product: Doc, req?: Partial<PayloadRequest>): Promise<Doc & { id: number | string }> => {
  const existing = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product.id } }, { labels: { equals: DOCS_CHECK_LABEL } }] }, limit: 1, ...o, req })).docs[0]
  if (existing) return existing as Doc & { id: number | string }
  const issue = await (await forgeOf(payload, product.id, req)).tickets.create({
    title: `Docs checks: ${product.name}`,
    body: 'Anchor Ticket of the docs check Runs for this Product. Bauherr keeps it open; each check with findings files one docs Ticket.',
    labels: [DOCS_CHECK_LABEL],
  })
  return upsertTicket(payload, { workspace: id(product.workspace), product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: 'open', labels: issue.labels }, null, req)
}

/**
 * Starts a docs Run (always autonomous) on the Product's anchor Ticket unless one is active.
 * One transaction under a per-Product advisory lock taken on that transaction's connection, every read and write on the same connection,
 * so two clicks cannot both create the anchor Ticket.
 */
export const startDocsCheck = async (payload: Payload, productId: number | string): Promise<{ run: Doc; created: boolean }> => {
  const req = await createLocalReq({}, payload)
  const tx = await payload.db.beginTransaction()
  if (!tx) throw new Error('database transactions unavailable')
  req.transactionID = tx
  try {
    const db = payload.db as unknown as { sessions: Record<string, { db: { execute: (q: unknown) => Promise<unknown> } }> }
    await db.sessions[await tx]!.db.execute(sql`SELECT pg_advisory_xact_lock(${DOCS_LOCK}::int, ${Number(productId)}::int)`)
    const product = (await payload.findByID({ collection: 'products', id: productId, ...o, req })) as Doc
    const started = await startRunIfNeeded(payload, await anchorTicket(payload, product, req), 'docs', {}, req)
    await payload.db.commitTransaction(tx)
    return started
  } catch (e) {
    await payload.db.rollbackTransaction(tx)
    throw e
  }
}

export type MergedTicket = { number: number; title: string; mergeSha: string }

/** Where a check counts from: the last finished check, else the last published release, else 30 days back. */
export const sinceOf = (product: Doc, now = new Date()): Date =>
  new Date(product.docsCheck?.lastCheckAt ?? product.lastReleaseAt ?? now.getTime() - FIRST_CHECK_DAYS * 86_400_000)

/** Tickets of the Product that entered the release stage after `sinceOf` and have a merge commit, oldest first, one row per Ticket. */
export const mergedSince = async (payload: Payload, product: Doc, now = new Date()): Promise<MergedTicket[]> => {
  const events = (await payload.find({ collection: 'ticket_events', where: { and: [{ stageKind: { equals: 'release' } }, { at: { greater_than: sinceOf(product, now).toISOString() } }, { 'ticket.product': { equals: product.id } }] }, sort: ['at', 'id'], pagination: false, select: { ticket: true }, ...o })).docs as Doc[]
  const ids = [...new Set(events.map((e) => id(e.ticket)))]
  if (!ids.length) return []
  const tickets = (await payload.find({ collection: 'tickets', where: { and: [{ id: { in: ids } }, { mergeSha: { exists: true } }] }, pagination: false, select: { number: true, title: true, mergeSha: true }, ...o })).docs as Doc[]
  const byId = new Map(tickets.map((t) => [id(t.id), t]))
  return ids.flatMap((i) => {
    const t = byId.get(i)
    return t?.mergeSha ? [{ number: t.number, title: t.title, mergeSha: t.mergeSha }] : []
  })
}

/** The docs part of a docs Run's context. */
export const docsContext = async (payload: Payload, product: Doc) => ({ paths: (product.docsCheck?.paths as string[] | undefined) ?? DEFAULT_DOCS_PATHS, merged: await mergedSince(payload, product) })

export type DocsFindings = { stale: { file: string; claim: string; commit: string; fix: string }[]; missing: { ticket: number; commit: string; feature: string; file: string }[] }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v)

/** Parses `.bauherr/docs-findings.json`; throws on any shape error so nothing is filed from a bad file. */
export const parseDocsFindings = (raw: unknown): DocsFindings => {
  const r = raw as { stale?: unknown; missing?: unknown } | null
  if (!r || !Array.isArray(r.stale) || !Array.isArray(r.missing)) throw new Error('docs-findings.json must be {"stale": [...], "missing": [...]}')
  const stale = r.stale.map((f, i) => {
    if (!(f && isText(f.file) && isText(f.claim) && isSha(f.commit) && isText(f.fix))) throw new Error(`docs-findings.json stale entry ${i} needs file, claim, commit (a git sha) and fix`)
    return { file: f.file, claim: f.claim, commit: f.commit, fix: f.fix }
  })
  const missing = r.missing.map((f, i) => {
    const ticket = Number(f?.ticket)
    if (!(f && Number.isInteger(ticket) && ticket > 0 && isSha(f.commit) && isText(f.feature) && isText(f.file))) throw new Error(`docs-findings.json missing entry ${i} needs ticket (a number), commit (a git sha), feature and file`)
    return { ticket, commit: f.commit, feature: f.feature, file: f.file }
  })
  return { stale, missing }
}

const line = (s: string) => scrub(s).replace(/\s+/g, ' ')
const code = (s: string) => `\`${line(s).replace(/`/g, "'")}\``

/** One checkbox per finding with file and commit as evidence; at most 30, the rest listed as overflow. */
export const docsTicketBody = (run: Doc, paths: string[], f: DocsFindings): string => {
  const items = [
    ...f.stale.map((s) => `- [ ] ${code(s.file)} is stale: ${line(s.claim)} (commit ${code(s.commit)}). Write: ${line(s.fix)}`),
    ...f.missing.map((m) => `- [ ] Document ${line(m.feature)} (#${m.ticket}, commit ${code(m.commit)}) in ${code(m.file)}`),
  ]
  return [
    marker(run.id),
    `Found by docs check Run #${run.id}. Change only files that match the docs paths: ${paths.map(code).join(', ')}.`,
    `## Acceptance criteria\n${items.slice(0, ITEM_CAP).join('\n')}`,
    ...(items.length > ITEM_CAP ? [`## Not listed (over ${ITEM_CAP})\n${items.slice(ITEM_CAP).map((i) => i.replace('- [ ] ', '- ')).join('\n')}`] : []),
  ].join('\n\n')
}

/**
 * Files the findings of a succeeded docs Run as one docs Ticket in Plan, or updates the open docs Ticket in place; zero findings files nothing.
 * A bad findings file fails the Run and records nothing. Idempotent per Run: a body that already carries the Run's marker is left alone.
 * The check is recorded (`docsCheck.lastCheckAt`/`lastCheckRun`) once filing is done.
 */
export const fileDocsTicket = async (payload: Payload, run: Doc): Promise<{ filed: 'created' | 'updated' | 'none' }> => {
  let findings: DocsFindings
  try {
    findings = parseDocsFindings(run.artifacts?.docs)
  } catch (e) {
    await payload.update({ collection: 'runs', id: run.id, data: { status: 'failed', error: `docs findings: ${(e as Error).message}` }, ...o })
    return { filed: 'none' }
  }
  const ticket = (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc
  const product = (await payload.findByID({ collection: 'products', id: id(ticket.product), ...o })) as Doc
  const paths = (product.docsCheck?.paths as string[] | undefined) ?? DEFAULT_DOCS_PATHS
  let filed: 'created' | 'updated' | 'none' = 'none'
  if (findings.stale.length + findings.missing.length) {
    const { tickets } = await forgeOf(payload, product.id)
    const body = docsTicketBody(run, paths, findings)
    const open = (await tickets.list({ labels: [DOCS_LABEL], state: 'open' }))[0]
    if (open) {
      if (!open.body?.includes(marker(run.id))) {
        await tickets.update(String(open.number), { body })
        filed = 'updated'
      }
    } else {
      const wf = workflowFor(run.workspace)
      const plan = nameOf(wf, 'plan')
      const issue = await tickets.create({ title: `Docs update ${new Date().toISOString().slice(0, 10)}: ${product.name}`, body, labels: [DOCS_LABEL, typeLabel('change'), stageLabel(plan)] })
      await upsertTicket(payload, { workspace: id(product.workspace), product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: 'open', labels: issue.labels, stage: plan }, null)
      filed = 'created'
    }
  }
  await payload.update({ collection: 'products', id: product.id, data: { docsCheck: { ...product.docsCheck, lastCheckAt: run.createdAt ?? new Date().toISOString(), lastCheckRun: Number(run.id) } }, ...o })
  return { filed }
}
