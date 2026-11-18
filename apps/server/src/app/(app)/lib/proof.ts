import { proofRules } from '@bauherr/runner'
import type { Payload } from 'payload'

type Doc = Record<string, any>

export type ProofItem = { id: number; kind: 'image' | 'recording' | 'preview' | 'transcript' | 'sample' | 'report'; title: string; pair?: 'before' | 'after'; url?: string; text?: string; file?: boolean }
export type ProofRow = { criterion: string | null; items: ProofItem[] }
export type ProofData = { ticket: number; rows: ProofRow[]; /** Rules whose proof was waived with an Evidence line `No artifact: <rule>: <reason>`. */ waived: { rule: string; reason: string }[]; staging: string | null }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export const buildProof = (a: { ticket: number; criteria: string[]; artifacts: Doc[]; staging?: string | null }): ProofData => {
  const rows = a.criteria.map((criterion): ProofRow => ({ criterion, items: [] }))
  const rowFor = (c: string | null): ProofRow => {
    const key = c ? norm(c) : null
    let row = rows.find((r) => (r.criterion ? norm(r.criterion) : null) === key)
    if (!row) rows.push((row = { criterion: c, items: [] }))
    return row
  }
  const waived: ProofData['waived'] = []
  for (const x of a.artifacts) {
    if (x.waived) {
      waived.push({ rule: x.rule, reason: x.text ?? '' })
      continue
    }
    rowFor(x.criterion || null).items.push({ id: x.id, kind: x.kind, title: x.title, ...(x.pair && { pair: x.pair }), ...(x.url && { url: x.url }), ...(x.text && { text: x.text }), ...(x.media && { file: true }) })
  }
  rows.sort((p, q) => Number(p.criterion === null) - Number(q.criterion === null))
  return { ticket: a.ticket, rows, waived, staging: a.staging ?? null }
}

export const loadProof = async (payload: Payload, tickets: Doc[], products: Map<number, Doc>, fallback: (t: Doc) => string[] = () => []): Promise<Map<number, ProofData>> => {
  const out = new Map<number, ProofData>()
  if (!tickets.length) return out
  const o = { overrideAccess: true, depth: 0, pagination: false } as const
  const [arts, sessions] = await Promise.all([
    payload.find({ collection: 'artifacts', where: { ticket: { in: tickets.map((t) => t.id) } }, sort: '-createdAt', ...o }),
    payload.find({ collection: 'intake_sessions', where: { and: [{ ticketNumber: { in: tickets.map((t) => t.number) } }, { status: { equals: 'submitted' } }] }, select: { draft: true, ticketNumber: true, product: true }, ...o }),
  ])
  for (const t of tickets) {
    const mine = (arts.docs as Doc[]).filter((a) => (typeof a.ticket === 'object' ? a.ticket.id : a.ticket) === t.id)
    const product = products.get(t.product)
    if (!mine.length && !proofRules(product?.reviewChecks, product?.pathSets).length) continue
    const sha = mine[0]?.sha
    const session = (sessions.docs as Doc[]).find((s) => s.ticketNumber === t.number && s.product === t.product)
    const criteria = ((session?.draft?.acceptance_criteria as string[] | undefined) ?? fallback(t)).filter((c) => c?.trim())
    out.set(t.id, buildProof({ ticket: t.id, criteria, artifacts: mine.filter((a) => a.sha === sha).reverse(), staging: product?.stagingUrl || null }))
  }
  return out
}

export type EvidenceStep = { step: number; title?: string; status: 'proved' | 'no_proof'; proof: string }

export const parseEvidence = (md: string | null | undefined, planSteps: { n: number; title: string }[] = []): { steps: EvidenceStep[]; rest: string } | null => {
  const lines = (md ?? '').split('\n')
  const head = lines.findIndex((l, i) => /^\s*\|\s*Plan step\s*\|/i.test(l) && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? ''))
  if (head < 0) return null
  let end = head + 2
  const steps: EvidenceStep[] = []
  for (; end < lines.length && /^\s*\|/.test(lines[end]!); end++) {
    const m = /^\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|(.*)$/.exec(lines[end]!)
    const step = Number(m?.[1])
    if (!m || !Number.isInteger(step) || step < 1) continue
    const [, , status, rest] = m
    const proof = rest!.replace(/\|\s*$/, '').trim()
    const title = planSteps.find((p) => p.n === step)?.title
    steps.push({ step, ...(title && { title }), status: /^done$/i.test(status!) && proof ? 'proved' : 'no_proof', proof })
  }
  return steps.length ? { steps, rest: [...lines.slice(0, head), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim() } : null
}
