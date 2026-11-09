import type { Payload } from 'payload'
import { startRunIfNeeded } from '../jobs'
import { upsertTicket } from './actions'
import { createHash } from 'node:crypto'
import { stageLabel } from '@bauherr/adapters'
import { SECURITY_FINDING_MARKER } from '../app/(app)/lib/plan'
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

/** Starts a scan Run (always autonomous) on the Product's anchor Ticket unless one is active and records `lastScanAt` for a new one. */
export const startSecurityScan = async (payload: Payload, productId: number | string): Promise<{ run: Doc; created: boolean }> => {
  const product = (await payload.findByID({ collection: 'products', id: productId, ...o })) as Doc
  const started = await startRunIfNeeded(payload, await anchorTicket(payload, product), 'scan')
  if (started.created) await payload.update({ collection: 'products', id: product.id, data: { securityScan: { ...product.securityScan, lastScanAt: new Date().toISOString() } }, ...o })
  return started
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
type Severity = (typeof SEVERITIES)[number]
export type Finding = { rootCause: string; title: string; severity: Severity; files: string[]; evidence: string; fix: string }
const FINDING_CAP = 10
const TEXT_CAP = 2000
const SECURITY_LABEL = 'bauherr:security'
const sevLabel = (s: Severity) => `security:${s}`

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Parses `.bauherr/findings.json`; throws on any shape error so nothing is filed from a bad file. */
export const parseFindings = (raw: unknown): Finding[] => {
  if (!Array.isArray(raw)) throw new Error('findings.json must be an array')
  return raw.map((f, i) => {
    const ok = f && isText(f.rootCause) && isText(f.title) && SEVERITIES.includes(f.severity) && Array.isArray(f.files) && f.files.every(isText) && typeof f.evidence === 'string' && typeof f.fix === 'string'
    if (!ok) throw new Error(`findings.json entry ${i} needs rootCause, title, severity (critical|high|medium|low), files[], evidence and fix`)
    return f as Finding
  })
}

/** Truncates to 2000 characters and redacts token-like strings. */
export const scrub = (text: string): string =>
  text
    .replace(/\b(?:gh[pousr]_|github_pat_|glpat-|sk-|xox[abprs]-|AKIA)[A-Za-z0-9_-]{8,}|\bBearer\s+\S+|\b[A-Za-z0-9+]{32,}\b/g, '[redacted]')
    .slice(0, TEXT_CAP)

/** sha256(slug|normalised rootCause|sorted paths), 12 hex characters. Line numbers never enter the key. */
export const findingKey = (slug: string, f: Pick<Finding, 'rootCause' | 'files'>): string =>
  createHash('sha256').update(`${slug}|${f.rootCause.toLowerCase().replace(/\s+/g, ' ').trim()}|${[...new Set(f.files)].sort().join(',')}`).digest('hex').slice(0, 12)

const MARKER_RE = /<!-- bauherr:security-finding:([0-9a-f]{12}) -->/
const rank = (s: Severity) => SEVERITIES.indexOf(s)

/**
 * Files the findings of a finished (or budget-exhausted) scan Run as Tickets, deduplicated by key marker.
 * Forge budget: one list call, at most 10 creates, at most 11 comments; no per-finding DB queries.
 */
export const fileFindings = async (payload: Payload, run: Doc): Promise<{ created: number; seen: number }> => {
  let findings: Finding[]
  try {
    findings = parseFindings(run.artifacts?.scan)
  } catch (e) {
    await payload.update({ collection: 'runs', id: run.id, data: { status: 'failed', error: `findings: ${(e as Error).message}` }, ...o })
    return { created: 0, seen: 0 }
  }
  const ticket = (await payload.findByID({ collection: 'tickets', id: id(run.ticket), ...o })) as Doc
  const product = (await payload.findByID({ collection: 'products', id: id(ticket.product), ...o })) as Doc
  const { tickets } = await forgeOf(payload, product.id)
  const known = new Map<string, { number: number; state: string; labels: string[] }>()
  for (const t of await tickets.list({ labels: [SECURITY_LABEL], state: 'all' })) {
    const key = t.body?.match(MARKER_RE)?.[1]
    if (key) known.set(key, t)
  }
  const seenNote = `Seen again in scan Run #${run.id}.`
  let created = 0
  let seen = 0
  const overflow: string[] = []
  const keyed = new Map<string, Finding>()
  for (const f of findings) {
    const key = findingKey(product.slug, f)
    const prev = keyed.get(key)
    if (!prev || rank(f.severity) > rank(prev.severity)) keyed.set(key, f)
  }
  const ordered = [...keyed].sort(([, a], [, b]) => rank(b.severity) - rank(a.severity))
  for (const [key, f] of ordered) {
    const hit = known.get(key)
    if (hit) {
      seen++
      if (hit.state === 'closed') {
        await tickets.comment(String(hit.number), seenNote)
        continue
      }
      const current = SEVERITIES.find((s) => hit.labels.includes(sevLabel(s)))
      if (current && rank(f.severity) > rank(current)) {
        await tickets.comment(String(hit.number), `${seenNote} Severity raised from ${current} to ${f.severity}.`)
        await tickets.removeLabels(String(hit.number), [sevLabel(current)])
        await tickets.addLabels(String(hit.number), [sevLabel(f.severity)])
      }
      continue
    }
    if (created >= FINDING_CAP) {
      overflow.push(`- ${f.severity}: ${f.title}`)
      continue
    }
    const body = [
      SECURITY_FINDING_MARKER(key),
      `**Severity:** ${f.severity}`,
      `**Files:** ${f.files.map((x) => `\`${x}\``).join(', ')}`,
      `**Found by scan Run #${run.id}**`,
      `## Evidence\n${scrub(f.evidence)}`,
      `## Fix\n${scrub(f.fix)}`,
    ].join('\n\n')
    await tickets.create({ title: f.title, body, labels: [SECURITY_LABEL, sevLabel(f.severity), ...(rank(f.severity) >= rank('high') ? [stageLabel('triage')] : [])] })
    created++
  }
  if (overflow.length) await tickets.comment(String(ticket.number), `Scan Run #${run.id} found more than ${FINDING_CAP} new findings; not filed this time:\n${overflow.join('\n')}`)
  return { created, seen }
}
