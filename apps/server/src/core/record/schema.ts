import { z } from 'zod'

const text = (max: number) => z.string().trim().min(1).max(max)
const ident = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[1-9][0-9]*$`))

export const TYPES = ['bug', 'feature', 'change', 'chore'] as const
export const CRITERION_STATUSES = ['open', 'met', 'partial', 'missing', 'waived'] as const

const source = z.object({
  forge: z.enum(['github', 'gitlab']),
  repo: z.string().trim().min(1),
  number: z.number().int().positive(),
  reporter: z.string().trim().min(1),
  external: z.boolean(),
  backlog: z.boolean(),
  adopted: z.object({ pr: z.number().int().positive() }).optional(),
  memory: z.number().int().positive().optional(),
  readiness: z.string().min(1).optional(),
})

export const criterionSchema = z.object({
  id: ident('c'),
  text: text(160),
  verify: z.object({ kind: z.enum(['test', 'command', 'screenshot', 'manual']), how: text(200) }),
  status: z.enum(CRITERION_STATUSES),
  proof: z.array(z.string().trim().min(1)),
})

export const riskSchema = z.object({
  door: z.enum(['one-way', 'two-way']),
  areas: z.array(z.string().trim().min(1)).max(5),
  rollback: text(200),
})

const option = z.object({ id: z.string().trim().min(1), label: text(80) })

const decision = z
  .object({
    id: ident('d'),
    question: text(200),
    options: z.array(option).min(2).max(4),
    recommended: z.string().trim().min(1),
    answer: z.string().trim().min(1).optional(),
    by: z.enum(['owner', 'factory']).optional(),
    at: z.iso.datetime().optional(),
  })
  .superRefine((d, ctx) => {
    const ids = d.options.map((o) => o.id)
    if (!ids.includes(d.recommended)) {
      ctx.addIssue({ code: 'custom', path: ['recommended'], message: 'must be the id of one of the options' })
    }
    if (d.answer !== undefined && !ids.includes(d.answer)) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'must be the id of one of the options' })
    }
    const given = [d.answer, d.by, d.at].filter((v) => v !== undefined).length
    if (given !== 0 && given !== 3) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'answer, by and at are given together or not at all' })
    }
  })

export const findingSchema = z.object({
  id: ident('f'),
  axis: z.enum(['spec', 'standards', 'security']),
  text: text(300),
  evidence: z.object({ kind: z.enum(['test', 'repro']), pointer: text(200) }),
  status: z.enum(['open', 'fixing', 'fixed', 'invalid']),
})

export const resultSchema = z.object({
  changes: z.array(z.object({ text: text(160), tag: z.enum(['visible', 'behaviour', 'internal']) })).max(5),
  walkthrough: z.array(text(160)).max(5),
  notVerified: z.array(text(160)).max(5),
  cost: z.object({
    usd: z.number().min(0),
    runs: z.number().int().min(0),
    minutes: z.number().int().min(0),
  }),
})

const shape = z.object({
  v: z.literal(1),
  goal: z.string().trim().max(300),
  type: z.enum(TYPES),
  source,
  criteria: z.array(criterionSchema).max(7),
  outOfScope: z.array(text(160)).max(5),
  visible: z.boolean().default(false),
  risk: riskSchema.nullable(),
  decisions: z.array(decision).max(12),
  plan: z.object({ steps: z.array(text(160)).max(7) }),
  findings: z.array(findingSchema).max(20),
  handoff: z.string().trim().max(1200),
  result: resultSchema.nullable(),
})

const uniqueIds = (items: { id: string }[], field: string, ctx: z.RefinementCtx) => {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({ code: 'custom', path: [field, index, 'id'], message: `duplicate id ${item.id}` })
    }
    seen.add(item.id)
  })
}

export const recordSchema = shape.superRefine((r, ctx) => {
  uniqueIds(r.criteria, 'criteria', ctx)
  uniqueIds(r.decisions, 'decisions', ctx)
  uniqueIds(r.findings, 'findings', ctx)
})

export const briefReady = recordSchema.superRefine((r, ctx) => {
  if (r.goal === '') ctx.addIssue({ code: 'custom', path: ['goal'], message: 'the goal is not written' })
  if (r.criteria.length < 3) ctx.addIssue({ code: 'custom', path: ['criteria'], message: 'needs at least 3 criteria' })
  if (r.risk === null) ctx.addIssue({ code: 'custom', path: ['risk'], message: 'the risk is not assessed' })
})

export type TicketRecord = z.infer<typeof recordSchema>
export type RecordSource = TicketRecord['source']
export type RecordType = TicketRecord['type']
export type Criterion = TicketRecord['criteria'][number]
export type Decision = TicketRecord['decisions'][number]
export type Finding = TicketRecord['findings'][number]
export type RecordField = keyof TicketRecord
export const RECORD_FIELDS = Object.keys(shape.shape) as RecordField[]

export const emptyRecord = (recordSource: RecordSource, type: RecordType): TicketRecord => ({
  v: 1,
  goal: '',
  type,
  source: recordSource,
  criteria: [],
  outOfScope: [],
  visible: false,
  risk: null,
  decisions: [],
  plan: { steps: [] },
  findings: [],
  handoff: '',
  result: null,
})
