import { z } from 'zod'
import { DOCUMENT_SCOPES } from '../memory'
import { SECTIONS } from '../memory-sections'

export const LEVELS = ['product', 'workspace', 'factory', 'ticket'] as const
export const REPOS = ['product', 'factory'] as const
export const DECISIONS = ['undecided', 'keep', 'discard'] as const

export type Level = (typeof LEVELS)[number]
export type Decision = (typeof DECISIONS)[number]
export type Repo = (typeof REPOS)[number]

const text = z.string().trim().min(1)

const changeSchema = z.object({
  section: z.enum(SECTIONS),
  remove: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  add: text,
})

const ticketSchema = z.object({ title: text, body: text, repo: z.enum(REPOS) })

export const proposalSchema = z
  .object({
    id: text,
    level: z.enum(LEVELS),
    title: text,
    cause: z.string().default(''),
    evidence: z.array(z.number().int()).default([]),
    confidence: z.enum(['high', 'medium', 'low']).default('medium'),
    change: changeSchema.optional(),
    ticket: ticketSchema.optional(),
  })
  .refine((proposal) => (proposal.level === 'ticket' ? proposal.ticket : proposal.change) !== undefined, {
    message: 'a ticket proposal carries a ticket and every other level a document change',
  })

export const replySchema = z.object({
  message: text,
  proposals: z.array(proposalSchema).default([]),
  agreed: z.array(text).default([]),
})

export type Proposal = z.infer<typeof proposalSchema>
export type Reply = z.infer<typeof replySchema>
export type DocumentChange = z.infer<typeof changeSchema>

export const outcomeSchema = z.object({
  documents: z.array(
    z.object({
      scope: z.enum(DOCUMENT_SCOPES),
      base: z.string(),
      changes: z.array(
        changeSchema.extend({ id: text, title: text, decision: z.enum(DECISIONS) }),
      ),
    }),
  ),
  tickets: z.array(
    ticketSchema.extend({
      id: text,
      decision: z.enum(DECISIONS),
      number: z.number().int().nullable(),
    }),
  ),
  saved: z.array(z.enum(DOCUMENT_SCOPES)),
})

export type Outcome = z.infer<typeof outcomeSchema>
export type OutcomeDocument = Outcome['documents'][number]
export type OutcomeChange = OutcomeDocument['changes'][number]
export type OutcomeTicket = Outcome['tickets'][number]

export const openingSchema = z.object({
  counts: z.object({ accepted: z.number(), runs: z.number(), questions: z.number() }),
  figures: z.array(
    z.object({
      key: z.string(),
      value: z.number().nullable(),
      previous: z.number().nullable(),
      history: z.array(z.number().nullable()),
      farOff: z.boolean(),
    }),
  ),
  tickets: z.array(
    z.object({
      recordId: z.number(),
      title: z.string(),
      verifyRounds: z.number(),
      sendBacks: z.number(),
      failedRuns: z.number(),
      questions: z.number(),
      off: z.array(z.string()),
    }),
  ),
})

export const partsSchema = z.object({ proposals: z.array(proposalSchema), raw: z.string() })

export type Opening = z.infer<typeof openingSchema>
export type OpeningTicket = Opening['tickets'][number]
export type OpeningFigure = Opening['figures'][number]
export type Parts = z.infer<typeof partsSchema>

export const RETRO_STATES = ['open', 'outcome', 'applied'] as const
export type RetroState = (typeof RETRO_STATES)[number]

export class RetroError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
export class RetroNotFound extends RetroError {}
export class RetroInvalid extends RetroError {}
export class RetroUndecided extends RetroError {}
