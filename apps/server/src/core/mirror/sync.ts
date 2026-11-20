import type { Ticket, TicketSummary } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { connectionInput } from '../../lib/connection'
import { readerFor, type ForgeReader, type ReadTickets } from '../forge/reader'
import { commentRow, errorText, isDue, itemFromTicket, laterOf, lookbackFrom, takeBatch } from './map'
import { BATCH, isCurrent, reconcile, syncPulls, type PullContext } from './pulls'
import {
  finishSource,
  knownItems,
  latestCommentAt,
  liveSources,
  saveCursor,
  upsertComments,
  upsertItem,
  type SourcePatch,
  type SourceRow,
} from './store'

export const LOOKBACK_HOURS = 6
const LOOKBACK_EVERY_MS = 3_600_000
const RECONCILE_EVERY_MS = 86_400_000

export type SyncDeps = {
  reader: (source: SourceRow) => Promise<ForgeReader>
  now: () => Date
  afterStored?: (source: SourceRow, itemIds: number[]) => Promise<void>
}

export type SyncResult = { synced: number; failed: number }

const storeIssue = async (payload: Payload, context: PullContext, tickets: ReadTickets, change: TicketSummary) => {
  const ticket: Ticket = await tickets.get(change.id)
  const item = await upsertItem(payload, context, itemFromTicket(ticket), context.now)
  const since = await latestCommentAt(payload, item)
  const comments = await tickets.listComments(change.id, since ?? undefined)
  await upsertComments(payload, context.workspace, item, comments.map(commentRow))
}

const pollIssues = async (
  payload: Payload,
  context: PullContext,
  tickets: ReadTickets,
  since: string | null,
): Promise<{ cursor: string | null; truncated: boolean; stored: number }> => {
  const { changes } = await tickets.poll(since)
  const known = await knownItems(payload, context.source, changes.map((change) => change.number))
  const fresh = changes.filter((change) => !isCurrent(known.get(change.number), change.updatedAt))
  const { batch, truncated } = takeBatch(fresh, BATCH)
  for (const change of batch) await storeIssue(payload, context, tickets, change)
  const reached = truncated ? batch.at(-1) : changes.at(-1)
  return { cursor: reached?.updatedAt ?? null, truncated, stored: batch.length }
}

const periodic = async (
  payload: Payload,
  context: PullContext,
  source: SourceRow,
  reader: ForgeReader,
  cursor: string | null,
): Promise<Pick<SourcePatch, 'lookbackAt' | 'reconciledAt'>> => {
  const patch: Pick<SourcePatch, 'lookbackAt' | 'reconciledAt'> = {}
  const tickets = reader.tickets(source.repo)
  if (source.importedAt === null) return patch
  if (cursor !== null && isDue(source.lookbackAt, context.now, LOOKBACK_EVERY_MS)) {
    const late = await pollIssues(payload, context, tickets, lookbackFrom(cursor, LOOKBACK_HOURS))
    if (!late.truncated) patch.lookbackAt = context.now
  }
  if (isDue(source.reconciledAt, context.now, RECONCILE_EVERY_MS)) {
    await reconcile(payload, context, { tickets, forge: reader.forge })
    patch.reconciledAt = context.now
  }
  return patch
}

const syncOne = async (payload: Payload, source: SourceRow, reader: ForgeReader, now: Date): Promise<number[]> => {
  const touched = new Set<number>()
  const context: PullContext = {
    workspace: source.workspace,
    product: source.product,
    source: source.id,
    repo: source.repo,
    now,
    touched,
  }
  const polled = await pollIssues(payload, context, reader.tickets(source.repo), source.cursor)
  const cursor = laterOf(source.cursor, polled.cursor)
  const moved = cursor !== null && cursor !== source.cursor
  if (moved) await saveCursor(payload, source.id, cursor)
  const imported = source.importedAt !== null
  const pulls = await syncPulls(payload, context, reader.forge, imported)
  const idle = !polled.truncated && polled.stored === 0 && pulls.fresh === 0
  const due = await periodic(payload, context, source, reader, cursor)
  const patch: SourcePatch = { error: null, polledAt: now, ...due }
  if (moved) patch.cursor = cursor
  if (!imported && idle) patch.importedAt = now
  await finishSource(payload, source.id, patch)
  return [...touched]
}

export const syncSources = async (payload: Payload, deps: SyncDeps): Promise<SyncResult> => {
  const result: SyncResult = { synced: 0, failed: 0 }
  for (const source of await liveSources(payload)) {
    const now = deps.now()
    try {
      const stored = await syncOne(payload, source, await deps.reader(source), now)
      await deps.afterStored?.(source, stored)
      result.synced++
    } catch (error) {
      result.failed++
      await finishSource(payload, source.id, { error: errorText(error), polledAt: now })
    }
  }
  return result
}

export const defaultDeps = (payload: Payload): SyncDeps => ({
  reader: async (source) => readerFor(await connectionInput(payload, source.connection)),
  now: () => new Date(),
})
