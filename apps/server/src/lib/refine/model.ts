import type { Decision } from '../../app/(app)/lib/plan'
import { readAnswer } from '../../app/(app)/lib/plan'
import type { Addressee } from '../workflow-rules'

/** Caps of one conversation (design: at most 3 new points per turn, 10 open at a time). */
export const MAX_ADDED = 3
export const MAX_OPEN = 10
export const MAX_TEXT = 2000
export const MAX_USER_MESSAGES = 60
const MAX_ANSWER = 500

export type PointStatus = 'open' | 'answered' | 'dropped'
/** One question of the decision sheet (or added by the conversation) with what became of it. */
export type Point = { id: string; title: string; why?: string; options: string[]; default: string; critical: boolean; status: PointStatus; answer?: string; source: 'triage' | 'conversation'; run?: number | null; /** Who answers it: the row's `for:`, else whom the checkpoint asks. */ for?: Addressee }

/** Who spoke a message: the Triage session that asked, or the Factory assistant (`model` null: no model call). */
export type Speaker = { kind: 'session' | 'assistant' | 'person'; role?: string; avatar?: string; session?: string; live?: boolean; run?: number | null; model?: string | null; at: string }
export type Tier = 'cheap' | 'standard' | 'strong'
export const TIERS: Tier[] = ['cheap', 'standard', 'strong']
export type Image = { id: number; url: string }
export type Usage = { model: string; tokensIn: number; tokensOut: number }
export type Msg = { id: string; role: 'user' | 'assistant'; text: string; speaker: Speaker; images?: Image[]; usage?: Usage; /** Ids of the points this message settled or dropped (shown as chips under it). */ settled?: string[]; feedback?: 'up' | 'down' | null }

export type Refine = {
  reply: string
  settled: { id: string; answer: string }[]
  dropped: { id: string; reason: string }[]
  added: Omit<Decision, 'id' | 'critical'>[]
  ticket?: { title?: string; body?: string }
  next: 'ask' | 'summary' | 'split'
}

/** The tool the model must end every turn with. */
export const REFINE_TOOL = {
  name: 'refine',
  description: 'End the turn: what you say, which open points the message settled or made pointless, new points it raised, optional edits to the request text, and what comes next.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'settled', 'dropped', 'added', 'next'],
    properties: {
      reply: { type: 'string', description: 'A few plain sentences. Ask at most one thing, the most important open point first.' },
      settled: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'answer'], properties: { id: { type: 'string' }, answer: { type: 'string' } } } },
      dropped: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
      added: { type: 'array', maxItems: MAX_ADDED, items: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string' }, why: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, default: { type: 'string' } } } },
      ticket: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, body: { type: 'string' } } },
      next: { enum: ['ask', 'summary', 'split'] },
    },
  },
} as const

const line = (v: unknown, n: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const MARKER = /<!--\s*bauherr:[^>]*-->/g

/** The sheet's rows as points, with the stored answers (a dropped row reads as `dropped`); added rows come after the sheet's, critical first within each. `by` is whom the checkpoint asks: the addressee of a row without `for:`. */
export const pointsOf = (sheet: Decision[], added: Decision[], answers: Record<string, string>, run: number | null, by: Addressee = 'bauherr'): Point[] => {
  const ids = new Set(sheet.map((d) => d.id))
  const row = (d: Decision, source: Point['source']): Point => {
    const a = answers[d.id] === undefined ? null : readAnswer(answers[d.id]!)
    return { id: d.id, title: d.title, ...(d.why && { why: d.why }), options: d.options, default: d.default, critical: d.critical, status: !a ? 'open' : a.dropped ? 'dropped' : 'answered', ...(a && { answer: a.text }), source, for: d.for ?? by, ...(source === 'triage' && { run }) }
  }
  const order = (ps: Point[]) => [...ps].sort((a, b) => Number(b.critical) - Number(a.critical))
  return [...order(sheet.map((d) => row(d, 'triage'))), ...added.filter((d) => !ids.has(d.id)).map((d) => row(d, 'conversation'))]
}

export const openOf = (points: Point[]): Point[] => points.filter((p) => p.status === 'open')

/**
 * Validates the model's `refine` input against the open points and the Ticket. Throws on anything else than the schema's shape, an unknown or already settled id,
 * a point named twice, an empty reply or answer, or ticket text that lost a `<!-- bauherr:... -->` marker. Nothing is applied here.
 */
export const normalizeRefine = (raw: any, points: Point[], ticket: { body: string }): Refine => {
  const bad = (why: string): never => {
    throw new Error(`invalid refine result: ${why}`)
  }
  if (!raw || typeof raw !== 'object') return bad('not an object')
  const reply = line(raw.reply, 1500)
  if (!reply) bad('empty reply')
  const open = new Set(openOf(points).map((p) => p.id))
  const seen = new Set<string>()
  const take = (id: unknown): string => {
    const k = String(id)
    if (!open.has(k) || seen.has(k)) bad(`unknown or repeated point ${k}`)
    seen.add(k)
    return k
  }
  const list = (v: unknown, max: number): any[] => (v === undefined ? [] : Array.isArray(v) && v.length <= max ? v : bad('bad list'))
  const settled = list(raw.settled, MAX_OPEN).map((s) => {
    const answer = line(s?.answer, MAX_ANSWER + 1)
    if (!answer || answer.length > MAX_ANSWER) bad('empty or long answer')
    return { id: take(s?.id), answer }
  })
  const dropped = list(raw.dropped, MAX_OPEN).map((d) => ({ id: take(d?.id), reason: line(d?.reason, 300) }))
  const added = list(raw.added, MAX_ADDED).map((a) => {
    const title = line(a?.question, 300)
    if (!title) bad('empty question')
    const options = [...new Set(list(a?.options, 6).map((o) => line(o, 150)).filter(Boolean))]
    const def = line(a?.default, 150) || options[0] || ''
    return { title, ...(line(a?.why, 300) && { why: line(a.why, 300) }), options: def && !options.includes(def) ? [def, ...options] : options, default: def }
  })
  let edits: Refine['ticket']
  if (raw.ticket !== undefined) {
    const title = raw.ticket?.title === undefined ? undefined : line(raw.ticket.title, 120)
    const body = raw.ticket?.body === undefined ? undefined : String(raw.ticket.body).replace(/\r\n/g, '\n').trim()
    if (title === '' || body === '' || (body !== undefined && body.length > 8000)) bad('empty or long ticket text')
    if (body !== undefined && (ticket.body.match(MARKER) ?? []).some((m) => !body.includes(m))) bad('ticket text lost a bauherr marker')
    if (title !== undefined || body !== undefined) edits = { ...(title !== undefined && { title }), ...(body !== undefined && { body }) }
  }
  if (!['ask', 'summary', 'split'].includes(raw.next)) bad('bad next')
  return { reply, settled, dropped, added, ...(edits && { ticket: edits }), next: raw.next }
}

/** The points after the result: settled and dropped marked, new ones numbered after the highest id; past `MAX_OPEN` the surplus is dropped and `capped` says so. */
export const applyRefine = (points: Point[], r: Refine): { points: Point[]; added: Decision[]; capped: boolean } => {
  const mark = new Map<string, Partial<Point>>([...r.settled.map((s) => [s.id, { status: 'answered', answer: s.answer }] as const), ...r.dropped.map((d) => [d.id, { status: 'dropped', answer: d.reason }] as const)])
  const next = points.map((p) => (mark.has(p.id) ? ({ ...p, ...mark.get(p.id) } as Point) : p))
  const room = Math.max(0, MAX_OPEN - openOf(next).length)
  const top = Math.max(0, ...points.map((p) => Number(/^D(\d+)$/.exec(p.id)?.[1] ?? 0)))
  const added = r.added.slice(0, room).map((a, i): Decision => ({ id: `D${top + i + 1}`, critical: false, ...a }))
  return { points: [...next, ...added.map((d): Point => ({ ...d, status: 'open', source: 'conversation' }))], added, capped: r.added.length > room }
}

export type DiffLine = { kind: 'context' | 'added' | 'removed'; text: string }

/** Line diff of two texts (longest common subsequence); unchanged lines further than two from a change are left out. */
export const lineDiff = (a: string, b: string): DiffLine[] => {
  const [x, y] = [a.split('\n'), b.split('\n')]
  const t = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) t[i]![j] = x[i] === y[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!)
  const out: DiffLine[] = []
  let [i, j] = [0, 0]
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      out.push({ kind: 'context', text: x[i]! })
      i++
      j++
    }
    else if (i < x.length && (j === y.length || t[i + 1]![j]! >= t[i]![j + 1]!)) out.push({ kind: 'removed', text: x[i++]! })
    else out.push({ kind: 'added', text: y[j++]! })
  }
  return out.flatMap((l, k) => {
    if (l.kind !== 'context') return [l]
    const near = (d: number) => out[k + d]?.kind !== undefined && out[k + d]!.kind !== 'context'
    return near(-1) || near(1) || near(-2) || near(2) ? [l] : []
  })
}
