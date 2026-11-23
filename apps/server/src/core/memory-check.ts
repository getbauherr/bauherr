import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export const CHECK_AT = 3
const TITLE_MAX = 80

export const PREVENTION_ASK =
  'Make this impossible or caught automatically: a test, a lint rule, a type or an API change. ' +
  'When that exists, the sentence is no longer needed. ' +
  'If no check can do it, say so in the Brief and propose one line for AGENTS.md instead.'

export type CheckState =
  | { kind: 'none' }
  | { kind: 'wants' }
  | { kind: 'building'; issue: number; record: number | null }
  | { kind: 'since'; issue: number; record: number | null }
  | { kind: 'discarded'; issue: number; record: number | null; at: string }

export type Prevention = {
  scope: 'ticket' | 'product'
  off: boolean
  cameBack: number
  issue: number | null
  record: number | null
  accepted: boolean
  endedAt: string | null
}

export const checkOf = (p: Prevention): CheckState => {
  if (p.issue === null) {
    return p.scope === 'product' && !p.off && p.cameBack >= CHECK_AT ? { kind: 'wants' } : { kind: 'none' }
  }
  const { issue, record } = p
  if (p.accepted) return { kind: 'since', issue, record }
  if (p.endedAt !== null) return { kind: 'discarded', issue, record, at: p.endedAt }
  return { kind: 'building', issue, record }
}

export const mayMakeCheck = (p: Prevention): boolean => {
  const { kind } = checkOf(p)
  return p.scope === 'product' && !p.off && (kind === 'none' || kind === 'wants' || kind === 'discarded')
}

export const acceptedCheck = sql`EXISTS (
  SELECT 1 FROM "records" c JOIN "events" e ON e."record_id" = c."id" AND e."type" = 'result.accepted'
  WHERE c."workspace_id" = s."workspace_id" AND c."source_number" = s."check_issue"
    AND c."data"->'source'->>'memory' = s."id"::text)`

export const preventionTitle = (text: string): string =>
  `Prevent by a check: ${text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text}`

export const referenceOf = (id: number, previous: number | null): string =>
  `bauherr-memory-${id}${previous === null ? '' : `-after-${previous}`}`

export type TicketLink = { number: number; title: string | null; url: string | null }
export type Origin = { from: string; text: string | null; ticket: TicketLink | null }
export type PreventionFacts = { text: string; origin: Origin; cameBack: TicketLink[] }

const link = (ticket: TicketLink): string => {
  const name = ticket.title === null ? `#${ticket.number}` : `#${ticket.number} ${ticket.title}`
  return ticket.url === null ? name : `[${name}](${ticket.url})`
}

const originLines = (origin: Origin): string[] => {
  const source = origin.ticket === null ? origin.from : `${origin.from}, ${link(origin.ticket)}`
  return ['## Where it came from', '', source, ...(origin.text === null ? [] : ['', '```text', origin.text, '```'])]
}

export const preventionBody = (facts: PreventionFacts): string =>
  [
    facts.text,
    originLines(facts.origin).join('\n'),
    ['## It came back on', '', ...facts.cameBack.map((ticket) => `- ${link(ticket)}`)].join('\n'),
    `## The ask\n\n${PREVENTION_ASK}`,
  ].join('\n\n')

const linkRow = z.object({ number: z.coerce.number(), url: z.string().nullable(), title: z.string().nullable() })

type Links = { workspace: number; records: number[] }

export const ticketLinks = async (payload: Payload, f: Links): Promise<TicketLink[]> => {
  if (f.records.length === 0) return []
  const found = await payload.db.drizzle.execute(sql`
    SELECT rec."source_number" AS number, i."url", i."title" FROM "records" rec
    LEFT JOIN "mirror_items" i ON i."workspace_id" = rec."workspace_id" AND i."repo" = rec."source_repo"
      AND i."number" = rec."source_number" AND i."kind" = 'issue'
    WHERE rec."workspace_id" = ${f.workspace}
      AND rec."id" IN (${sql.join(f.records.map((id) => sql`${id}`), sql`, `)})
    ORDER BY rec."source_number"`)
  return found.rows.map((raw) => linkRow.parse(raw))
}

const cameBackRow = z.object({ record: z.coerce.number() })

export const cameBackRecords = async (payload: Payload, id: number): Promise<number[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT c.v->>'record' AS record FROM "statements" s
    CROSS JOIN LATERAL jsonb_array_elements(s."came_back") AS c(v) WHERE s."id" = ${id}`)
  return found.rows.map((raw) => cameBackRow.parse(raw).record)
}

const sentenceRow = z.object({ id: z.coerce.number(), text: z.string() })

export const sentenceOf = async (
  payload: Payload,
  f: { workspace: number; id: number | undefined },
): Promise<{ id: number; text: string } | null> => {
  if (f.id === undefined) return null
  const found = await payload.db.drizzle.execute(
    sql`SELECT "id", "text" FROM "statements" WHERE "id" = ${f.id} AND "workspace_id" = ${f.workspace}`,
  )
  return found.rows[0] ? sentenceRow.parse(found.rows[0]) : null
}
