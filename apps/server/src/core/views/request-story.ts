import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { DISCLOSURE } from '../forge/disclosure'
import type { StoredEvent } from '../record/store'
import { readEvents } from '../record/store'
import type { TicketRecord } from '../record/schema'
import { commentFileUrl, commentsOf, type RequestComment } from '../requests/comments'
import { loadRunMockups } from './attachments'
import { ticket, type TicketView } from './ticket'
import type { TicketStatus } from './status'

export type StoryImage = { id: number; caption: string }
export type StoryFile = { name: string; url: string; image: boolean }
export type StoryList = { heading: string; items: string[] }
export type StoryKind = 'sent' | 'plan' | 'approved' | 'comment' | 'ready' | 'closed'

export type StoryEvent = {
  id: string
  kind: StoryKind
  at: string
  who: string
  title: string
  text: string
  images: StoryImage[]
  files: StoryFile[]
  lists: StoryList[]
}

export type RequestStory = {
  recordId: number
  number: number
  title: string
  status: TicketStatus
  ended: 'accepted' | 'closed' | null
  events: StoryEvent[]
  about: { type: string; by: string; created: string; product: string }
  links: { issue: string | null; staging: string | null }
}

const TYPE_WORDS: Record<TicketRecord['type'], string> = {
  bug: 'Problem',
  question: 'Question',
  change: 'Change',
  chore: 'Upkeep',
}

const CLOSE_WORDS: Record<string, string> = {
  'result.accepted': 'Closed: accepted',
  'brief.discarded': 'Closed: the plan was discarded',
  'ticket.done-elsewhere': 'Closed: the work was already done',
  'ticket.closed': 'Closed',
  'intake.closed': 'Closed: not taken on',
}

const commentRow = z.object({ author: z.string().nullable(), body: z.string().nullable(), at: z.coerce.date() })
const productRow = z.object({ name: z.string(), staging_url: z.string().nullable() })

const base = (event: Pick<StoryEvent, 'id' | 'kind' | 'at' | 'who' | 'title'>): StoryEvent => ({
  text: '',
  images: [],
  files: [],
  lists: [],
  ...event,
})

const loadComments = async (payload: Payload, workspace: number, view: TicketView): Promise<StoryEvent[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT c."author", c."body", c."forge_created_at" AS at FROM "mirror_comments" c
    JOIN "mirror_items" i ON i."id" = c."item_id"
    WHERE i."workspace_id" = ${workspace} AND i."repo" = ${view.record.source.repo}
      AND i."number" = ${view.number} AND c."forge_created_at" IS NOT NULL
    ORDER BY c."forge_created_at", c."id"`)
  return found.rows.flatMap((raw) => {
    const row = commentRow.parse(raw)
    const body = row.body ?? ''
    if (body.trimStart().startsWith(DISCLOSURE)) return []
    const at = row.at.toISOString()
    const id = `comment-${at}-${row.author}`
    return [{ ...base({ id, kind: 'comment', at, who: row.author ?? '', title: 'Comment' }), text: body }]
  })
}

const commentEvent = (comment: RequestComment): StoryEvent => ({
  ...base({
    id: `request-comment-${comment.id}`,
    kind: 'comment',
    at: comment.at,
    who: comment.author,
    title: 'Comment',
  }),
  text: comment.text,
  files: comment.files.map((file) => ({
    name: file.name,
    url: commentFileUrl(file),
    image: file.contentType.startsWith('image/'),
  })),
})

const loadProduct = async (payload: Payload, recordId: number) => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT p."name", p."staging_url" FROM "products" p JOIN "records" r ON r."product_id" = p."id"
    WHERE r."id" = ${recordId}`)
  return found.rows[0] ? productRow.parse(found.rows[0]) : { name: '', staging_url: null }
}

const checksOf = (record: TicketRecord): string[] => record.criteria.map((criterion) => criterion.text)

const planEvent = async (
  payload: Payload,
  event: StoredEvent & { type: 'brief.submitted' },
  position: { version: number; latest: boolean },
  view: TicketView,
): Promise<StoryEvent> => {
  const pictures = (await loadRunMockups(payload, Number(event.data.runId))).filter((shot) => !shot.html)
  const { record } = view
  const lists: StoryList[] = []
  if (position.latest) {
    lists.push({ heading: 'What will be checked', items: checksOf(record) })
    if (record.outOfScope.length > 0) lists.push({ heading: 'Not part of it', items: record.outOfScope })
  }
  return {
    ...base({
      id: `event-${event.id}`,
      kind: 'plan',
      at: event.createdAt,
      who: 'Factory',
      title: position.version === 1 ? 'The plan' : 'Plan updated',
    }),
    text: position.latest ? record.goal : '',
    images: pictures.map((shot) => ({ id: shot.id, caption: shot.caption })),
    lists,
  }
}

const readyEvent = (event: StoredEvent, latest: boolean, view: TicketView): StoryEvent => {
  const id = `event-${event.id}`
  const ready = base({ id, kind: 'ready', at: event.createdAt, who: 'Factory', title: 'Ready to try' })
  if (!latest) return ready
  const images = view.pairs.flatMap((pair): StoryImage[] => [
    ...(pair.before ? [{ id: pair.before.id, caption: `Before: ${pair.screen}, ${pair.width} px` }] : []),
    ...(pair.after ? [{ id: pair.after.id, caption: `After: ${pair.screen}, ${pair.width} px` }] : []),
  ])
  const items = view.record.criteria.map((criterion) => `${criterion.status === 'met' ? '✓' : '–'} ${criterion.text}`)
  return { ...ready, images, lists: [{ heading: 'What was checked', items }] }
}

const eventsOf = async (payload: Payload, stored: StoredEvent[], view: TicketView): Promise<StoryEvent[]> => {
  const plans = stored.filter((event) => event.type === 'brief.submitted')
  const readies = stored.filter((event) => event.type === 'verify.passed')
  const story: StoryEvent[] = []
  for (const event of stored) {
    if (event.type === 'brief.submitted') {
      const version = plans.indexOf(event) + 1
      story.push(await planEvent(payload, event, { version, latest: event === plans.at(-1) }, view))
    } else if (event.type === 'brief.approved') {
      const who = event.data.by === 'owner' ? 'Bauherr' : 'Factory'
      story.push(base({ id: `event-${event.id}`, kind: 'approved', at: event.createdAt, who, title: 'Plan approved' }))
    } else if (event.type === 'verify.passed') {
      story.push(readyEvent(event, event === readies.at(-1), view))
    } else if (event.type in CLOSE_WORDS) {
      const title = CLOSE_WORDS[event.type] ?? 'Closed'
      story.push(base({ id: `event-${event.id}`, kind: 'closed', at: event.createdAt, who: 'Factory', title }))
    }
  }
  return story
}

const byTime = (a: StoryEvent, b: StoryEvent): number => Date.parse(a.at) - Date.parse(b.at)

export const requestStory = async (
  payload: Payload,
  filter: { workspace: number; recordId: number },
): Promise<RequestStory> => {
  const view = await ticket(payload, filter)
  const stored = await readEvents(payload, view.recordId)
  const product = await loadProduct(payload, view.recordId)
  const first = stored[0]?.createdAt ?? new Date().toISOString()
  const sent = {
    ...base({ id: 'sent', kind: 'sent', at: first, who: view.record.source.reporter, title: 'Request sent' }),
    text: view.title,
  }
  const comments = await loadComments(payload, filter.workspace, view)
  const requested = (await commentsOf(payload, view.recordId, stored)).map(commentEvent)
  const events = [sent, ...(await eventsOf(payload, stored, view)), ...comments, ...requested].sort(byTime)
  return {
    recordId: view.recordId,
    number: view.number,
    title: view.title,
    status: view.status,
    ended: view.ended,
    events,
    about: {
      type: TYPE_WORDS[view.record.type],
      by: view.record.source.reporter,
      created: first,
      product: product.name,
    },
    links: { issue: view.source?.url ?? null, staging: product.staging_url },
  }
}
