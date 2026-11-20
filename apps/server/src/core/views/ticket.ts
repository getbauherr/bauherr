import type { Payload } from 'payload'
import type { Actor, EventType } from '../events'
import { RecordNotFound } from '../record/errors'
import { readEvents, readRecord, type StoredCard, type StoredRecord, type WaitingOn } from '../record/store'
import type { TicketRecord } from '../record/schema'
import { similarItems, type ItemHit } from '../mirror/search'
import { labelOf } from './labels'
import {
  loadChecks,
  loadItem,
  loadProofs,
  loadRuns,
  type CheckView,
  type ProofGroup,
  type RunView,
} from './ticket-parts'

export const SIMILAR_LIMIT = 3

export type EventView = { id: number; type: EventType; actor: Actor; at: string; label: string }

export type PullView = {
  number: number
  title: string
  url: string
  state: string
  headSha: string
  checks: CheckView[]
}

export type TicketView = {
  recordId: number
  version: number
  stage: StoredRecord['stage']
  waitingOn: WaitingOn
  parked: string | null
  card: StoredCard | null
  record: TicketRecord
  source: { repo: string; number: number; title: string; body: string; url: string } | null
  events: EventView[]
  runs: RunView[]
  proofs: ProofGroup[]
  pullRequest: PullView | null
  similarItems: ItemHit[]
}

export type TicketFilter = { workspace: number; recordId: number }

const pullOf = async (
  payload: Payload,
  workspace: number,
  repo: string,
  number: number | undefined,
): Promise<PullView | null> => {
  if (number === undefined) return null
  const item = await loadItem(payload, { workspace, repo, number })
  if (!item) return null
  const { title, url, state, headSha } = item
  return { number, title, url, state, headSha, checks: await loadChecks(payload, item) }
}

export const ticket = async (payload: Payload, filter: TicketFilter): Promise<TicketView> => {
  const stored = await readRecord(payload, filter.recordId)
  if (stored.workspace !== filter.workspace) {
    throw new RecordNotFound(`Record ${filter.recordId} does not exist: check the id.`)
  }
  const { repo, number } = stored.record.source
  const events = await readEvents(payload, stored.id)
  const issue = await loadItem(payload, { workspace: stored.workspace, repo, number })
  const built = events.findLast((event) => event.type === 'build.submitted')
  const pr = built?.type === 'build.submitted' ? built.data.pr : undefined
  return {
    recordId: stored.id,
    version: stored.version,
    stage: stored.stage,
    waitingOn: stored.waitingOn,
    parked: stored.parked,
    card: stored.card,
    record: stored.record,
    source: issue && { repo, number, title: issue.title, body: issue.body, url: issue.url },
    events: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, at: e.createdAt, label: labelOf(e) })),
    runs: await loadRuns(payload, stored.id),
    proofs: await loadProofs(payload, stored.id),
    pullRequest: await pullOf(payload, stored.workspace, repo, pr),
    similarItems: issue ? await similarItems(payload, issue.id, SIMILAR_LIMIT) : [],
  }
}
