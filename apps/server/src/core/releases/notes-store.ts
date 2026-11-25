import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MergedTicket } from './merged'
import { isArea } from './notes-areas'
import {
  classify,
  generate,
  mergeNotes,
  noteItemSchema,
  type AskModel,
  type NoteItem,
  type TicketFacts,
} from './notes'
import { sentence, title } from './notes-text'

export const UNRELEASED = 'unreleased'

type Where = { workspace: number; product: number; version: string }

export type StoredNotes = { items: NoteItem[]; internal: number; generatedAt: string }

const factsRow = z.object({
  id: z.coerce.number(),
  data: z.unknown(),
  title: z.string().nullable(),
  body: z.string().nullable(),
})
const recordData = z
  .looseObject({
    type: z.string().optional(),
    goal: z.string().optional(),
    risk: z.looseObject({ areas: z.array(z.string()) }).nullish(),
    relations: z.array(z.looseObject({ ticket: z.number() })).optional(),
    result: z.looseObject({ changes: z.array(z.looseObject({ text: z.string(), tag: z.string() })) }).nullish(),
  })
  .transform((data) => ({
    bug: data.type === 'bug',
    goal: data.goal ?? '',
    areas: data.risk?.areas ?? [],
    related: (data.relations ?? []).map((relation) => relation.ticket),
    changes: (data.result?.changes ?? []).filter((change) => change.tag === 'visible').map((change) => change.text),
  }))
  .catch({ bug: false, goal: '', areas: [], related: [], changes: [] })
const storedRow = z.object({
  items: z.array(z.unknown()),
  internal_count: z.coerce.number(),
  generated_at: z.coerce.date(),
})

const referencedIn = (own: number, ...texts: string[]): number[] =>
  [...new Set([...texts.join(' ').matchAll(/#(\d+)/g)].map((found) => Number(found[1])))].filter((n) => n !== own)

const factsOf = (ticket: MergedTicket, row: z.infer<typeof factsRow> | undefined): TicketFacts => {
  const { bug, goal, areas, related, changes } = recordData.parse(row?.data)
  const referenced = referencedIn(ticket.number, ticket.title, goal, row?.body ?? '')
  return {
    number: ticket.number,
    title: ticket.title,
    visible: ticket.visible,
    bug,
    goal,
    changes,
    areas,
    names: [...new Set([...related, ...referenced])],
  }
}

export const ticketFacts = async (payload: Payload, tickets: MergedTicket[]): Promise<TicketFacts[]> => {
  if (tickets.length === 0) return []
  const found = await payload.db.drizzle.execute(sql`
    SELECT r."id", r."data", t."title", t."body" FROM "records" r
    LEFT JOIN "mirror_items" t ON t."workspace_id" = r."workspace_id" AND t."repo" = r."source_repo"
      AND t."number" = r."source_number" AND t."kind" = 'issue'
    WHERE r."id" IN (${sql.join(tickets.map((ticket) => sql`${ticket.recordId}`), sql`, `)})`)
  const rows = new Map(found.rows.map((entry) => factsRow.parse(entry)).map((row) => [row.id, row]))
  return tickets.map((ticket) => factsOf(ticket, rows.get(ticket.recordId)))
}

export const readNotes = async (payload: Payload, product: number, version: string): Promise<StoredNotes | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "items", "internal_count", "generated_at" FROM "release_notes"
    WHERE "product_id" = ${product} AND "version" = ${version}`)
  if (!found.rows[0]) return null
  const row = storedRow.parse(found.rows[0])
  const items = row.items.flatMap((entry) => {
    const parsed = noteItemSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
  return { items, internal: row.internal_count, generatedAt: row.generated_at.toISOString() }
}

const writeNotes = async (
  payload: Payload,
  at: Where,
  notes: { items: NoteItem[]; internal: number },
  regenerated: boolean,
): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    INSERT INTO "release_notes" ("workspace_id", "product_id", "version", "items", "internal_count", "generated_at",
      "updated_at", "created_at")
    VALUES (${at.workspace}, ${at.product}, ${at.version}, ${JSON.stringify(notes.items)}::jsonb, ${notes.internal},
      now(), now(), now())
    ON CONFLICT ("product_id", "version") DO UPDATE SET "items" = EXCLUDED."items",
      "internal_count" = EXCLUDED."internal_count", "updated_at" = now(),
      "generated_at" = CASE WHEN ${regenerated} THEN now() ELSE "release_notes"."generated_at" END`)
}

export const writeNotesFor = async (
  payload: Payload,
  at: Where,
  tickets: MergedTicket[],
  ask: AskModel,
): Promise<void> => {
  const classified = classify(await ticketFacts(payload, tickets))
  const fresh = await generate(classified, ask)
  const existing = await readNotes(payload, at.product, at.version)
  const items = mergeNotes(existing?.items ?? [], fresh)
  await writeNotes(payload, at, { items, internal: classified.internal }, true)
}

export type { Where }
export type ItemEdit = { title: string; text: string; area: string }

const cleanEdit = (kind: NoteItem['kind'], edit: ItemEdit) => ({
  area: isArea(edit.area) ? edit.area : 'Factory',
  title: kind === 'fixed' ? null : title(edit.title, 4),
  text: sentence(edit.text, 20),
})

const change = async (
  payload: Payload,
  at: Where,
  apply: (items: NoteItem[]) => NoteItem[],
): Promise<void> => {
  const stored = await readNotes(payload, at.product, at.version)
  if (!stored) return
  await writeNotes(payload, at, { items: apply(stored.items), internal: stored.internal }, false)
}

export const editItem = (
  payload: Payload,
  at: Where,
  id: string,
  edit: ItemEdit,
): Promise<void> =>
  change(payload, at, (items) =>
    items.map((entry) => {
      const next = cleanEdit(entry.kind, edit)
      return entry.id === id && next.text !== '' && (entry.kind === 'fixed' || next.title !== '')
        ? { ...entry, ...next, edited: true }
        : entry
    }),
  )

export const addItem = (
  payload: Payload,
  at: Where,
  kind: NoteItem['kind'],
  edit: ItemEdit,
): Promise<void> => {
  const next = cleanEdit(kind, edit)
  return change(payload, at, (items) =>
    next.text === '' || (kind === 'new' && next.title === '')
      ? items
      : [...items, { id: randomUUID(), kind, ...next, tickets: [], edited: false, added: true, removed: false }],
  )
}

export const removeItem = (
  payload: Payload,
  at: Where,
  id: string,
): Promise<void> =>
  change(payload, at, (items) =>
    items.flatMap((entry) => {
      if (entry.id !== id) return [entry]
      return entry.added ? [] : [{ ...entry, removed: true }]
    }),
  )

