import { matchesGlob, isAbsolute } from 'node:path'
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

export const DOCS_CHECK_LABEL = 'bauherr:docs-check'
export const DOCS_LABEL = 'bauherr:docs'
export const DEFAULT_DOCS_PATHS = ['README.md', 'docs/**/*.md']
const FIRST_CHECK_DAYS = 30
const ITEM_CAP = 30
const DOCS_LOCK = 465
const marker = (runId: number | string) => `<!-- bauherr:docs-check:run:${runId} -->`
const markerRun = (body?: string) => Number(body?.match(/<!-- bauherr:docs-check:run:(\d+) -->/)?.[1] ?? 0)

const anchorTicket = async (payload: Payload, product: Doc, req?: Partial<PayloadRequest>): Promise<Doc & { id: number | string }> => {
  const existing = (await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: product.id } }, { labels: { equals: DOCS_CHECK_LABEL } }] }, limit: 1, ...o, req })).docs[0]
  if (existing) return existing as Doc & { id: number | string }
  const { tickets } = await forgeOf(payload, product.id, req)
  const issue =
    (await tickets.list({ labels: [DOCS_CHECK_LABEL], state: 'open' }))[0] ??
    (await tickets.create({
      title: `Docs checks: ${product.name}`,
      body: 'Anchor Ticket of the docs check Runs for this Product. Bauherr keeps it open; each check with findings files one docs Ticket.',
      labels: [DOCS_CHECK_LABEL],
    }))
  return upsertTicket(payload, { workspace: id(product.workspace), product: product.id, externalId: issue.id, number: issue.number, url: issue.url, title: issue.title, state: 'open', labels: issue.labels }, null, req)
}

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

export const sinceOf = (product: Doc, now = new Date()): Date =>
  new Date(product.docsCheck?.lastCheckAt ?? product.lastReleaseAt ?? now.getTime() - FIRST_CHECK_DAYS * 86_400_000)

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

const inDocsPaths = (file: string, paths: string[]) => !isAbsolute(file) && !file.split(/[\\/]/).includes('..') && paths.some((g) => matchesGlob(file, g))

export const outsideDocsPaths = (files: string[], paths: string[]): string[] => files.filter((f) => !inDocsPaths(f, paths))

export const checkAgainstMerged = (f: DocsFindings, merged: MergedTicket[], paths: string[]): void => {
  const numbers = new Set(merged.map((m) => m.number))
  const shas = new Set(merged.map((m) => m.mergeSha.toLowerCase()))
  for (const x of [...f.stale, ...f.missing]) if (!inDocsPaths(x.file, paths)) throw new Error(`file ${x.file} is outside the docs paths`)
  for (const m of f.missing) if (!numbers.has(m.ticket)) throw new Error(`missing entry names #${m.ticket}, which was not merged since the last check`)
  for (const c of [...f.stale, ...f.missing].map((x) => x.commit)) if (!shas.has(c.toLowerCase())) throw new Error(`commit ${c} is not a merge commit of the Tickets given to the Run`)
}

export const docsContext = async (payload: Payload, product: Doc) => ({ paths: (product.docsCheck?.paths as string[] | undefined) ?? DEFAULT_DOCS_PATHS, merged: await mergedSince(payload, product) })

export type DocsFindings = { stale: { file: string; claim: string; commit: string; fix: string }[]; missing: { ticket: number; commit: string; feature: string; file: string }[] }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{7,40}$/i.test(v)

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

export const fileDocsTicket = async (payload: Payload, run: Doc): Promise<{ filed: 'created' | 'updated' | 'none' }> => {
  if (run.status !== 'succeeded') return { filed: 'none' }
  const ticket = (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc
  const product = (await payload.findByID({ collection: 'products', id: id(ticket.product), ...o })) as Doc
  const paths = (product.docsCheck?.paths as string[] | undefined) ?? DEFAULT_DOCS_PATHS
  let findings: DocsFindings
  try {
    findings = parseDocsFindings(run.artifacts?.docs)
    checkAgainstMerged(findings, await mergedSince(payload, product), paths)
  } catch (e) {
    await payload.update({ collection: 'runs', id: run.id, data: { status: 'failed', error: `docs findings: ${(e as Error).message}` }, ...o })
    return { filed: 'none' }
  }
  let filed: 'created' | 'updated' | 'none' = 'none'
  if (findings.stale.length + findings.missing.length) {
    const { tickets } = await forgeOf(payload, product.id)
    const body = docsTicketBody(run, paths, findings)
    const open = (await tickets.list({ labels: [DOCS_LABEL], state: 'open' }))[0]
    if (open) {
      if (markerRun(open.body) < Number(run.id)) {
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
  if (Number(product.docsCheck?.lastCheckRun ?? 0) < Number(run.id)) await payload.update({ collection: 'products', id: product.id, data: { docsCheck: { ...product.docsCheck, lastCheckAt: run.createdAt ?? new Date().toISOString(), lastCheckRun: Number(run.id) } }, ...o })
  return { filed }
}
