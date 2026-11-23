import type { Payload } from 'payload'
import { commitChecksUrl } from '../deploy'
import { isRemembered } from '../decisions'
import type { Actor, EventType } from '../events'
import { RecordNotFound } from '../record/errors'
import {
  readEvents,
  readRecord,
  type StoredCard,
  type StoredEvent,
  type StoredRecord,
  type WaitingOn,
} from '../record/store'
import type { TicketRecord } from '../record/schema'
import type { IntakeFacts } from '../intake/facts'
import { loadIntakeFacts } from '../intake/facts-store'
import { questionPostedAt } from '../intake/posted'
import { similarItems, type ItemHit } from '../mirror/search'
import { loadMockups, type AttachmentView } from './attachments'
import { labelOf } from './labels'
import { statementsUsed, type StatementsUsed } from './statements-used'
import { closedAsOf, endedOf, type ClosedAs } from './rows'
import { TERMINAL_EVENTS } from './sql'
import { statusOf, type TicketStatus } from './status'
import {
  loadChecks,
  loadItem,
  loadOtherPulls,
  loadProofs,
  loadRuns,
  type CheckView,
  type OtherPull,
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
  author: string
  checks: CheckView[]
}

export type DeployView = { reason: 'failed' | 'overdue'; checks: string[]; url: string }

export type TicketView = {
  recordId: number
  number: number
  title: string
  status: TicketStatus
  closedAs: ClosedAs | null
  ended: 'accepted' | 'closed' | null
  facts: IntakeFacts | null
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
  mockups: AttachmentView[]
  pullRequest: PullView | null
  similarItems: ItemHit[]
  adopted: { pr: number; author: string } | null
  otherPulls: OtherPull[]
  statementsUsed: StatementsUsed
  deploy: DeployView | null
  answerRemembered: boolean
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
  const { title, url, state, headSha, author } = item
  return { number, title, url, state, headSha, author, checks: await loadChecks(payload, item) }
}

const pullsOf = async (payload: Payload, stored: StoredRecord, events: StoredEvent[]) => {
  const { repo, number, adopted } = stored.record.source
  const built = events.findLast((event) => event.type === 'build.submitted')
  const pr = adopted?.pr ?? (built?.type === 'build.submitted' ? built.data.pr : undefined)
  const pullRequest = await pullOf(payload, stored.workspace, repo, pr)
  return {
    pullRequest,
    adopted: adopted === undefined ? null : { pr: adopted.pr, author: pullRequest?.author ?? '' },
    otherPulls: await loadOtherPulls(payload, { workspace: stored.workspace, repo, issue: number, except: pr }),
  }
}

const deployOf = (stored: StoredRecord, events: StoredEvent[], pull: PullView | null): DeployView | null => {
  const stalled = events.findLast((event) => event.type === 'ship.deploy-stalled')
  const merged = events.findLast((event) => event.type === 'ship.merged')
  if (stored.card?.reason !== 'deploy-stalled' || stalled?.type !== 'ship.deploy-stalled') return null
  if (merged?.type !== 'ship.merged' || pull === null) return null
  const { reason, checks } = stalled.data
  return { reason, checks, url: commitChecksUrl(stored.record.source.forge, pull.url, merged.data.sha) }
}

const NOT_ENDED = { ended: null, closedAs: null } as const

const reasonOf = (event: StoredEvent | undefined): string | null =>
  event && 'reason' in event.data ? event.data.reason : null

const endOf = (stored: StoredRecord, events: StoredEvent[]) => {
  if (stored.waitingOn !== 'nobody' || stored.parked !== null) return NOT_ENDED
  const last = events.findLast((event) => TERMINAL_EVENTS.includes(event.type))
  const type = last?.type ?? null
  const ended = endedOf(type) ?? 'closed'
  return { ended, closedAs: ended === 'closed' ? closedAsOf(type, reasonOf(last)) : null }
}

type Ended = 'accepted' | 'closed' | null

const statusFor = (stored: StoredRecord, runs: RunView[], events: StoredEvent[], ended: Ended): TicketStatus => {
  const live = runs.find((run) => run.status === 'queued' || run.status === 'claimed')
  const { stage, waitingOn, card, parked } = stored
  const claimed = live?.status === 'claimed'
  const questionDrafted = questionPostedAt(events) === null
  return statusOf({ stage, waitingOn, card, parked, hasRun: live !== undefined, claimed, questionDrafted, ended })
}

export const ticket = async (payload: Payload, filter: TicketFilter): Promise<TicketView> => {
  const stored = await readRecord(payload, filter.recordId)
  if (stored.workspace !== filter.workspace) {
    throw new RecordNotFound(`Record ${filter.recordId} does not exist: check the id.`)
  }
  const { repo, number } = stored.record.source
  const events = await readEvents(payload, stored.id)
  const issue = await loadItem(payload, { workspace: stored.workspace, repo, number })
  const runs = await loadRuns(payload, stored.id)
  const { ended, closedAs } = endOf(stored, events)
  const pulls = await pullsOf(payload, stored, events)
  return {
    recordId: stored.id,
    number,
    title: issue?.title ?? `#${number}`,
    status: statusFor(stored, runs, events, ended),
    closedAs,
    ended,
    facts: stored.stage === 'intake' ? await loadIntakeFacts(payload, stored) : null,
    version: stored.version,
    stage: ended ? 'done' : stored.stage,
    waitingOn: stored.waitingOn,
    parked: stored.parked,
    card: stored.card,
    record: stored.record,
    source: issue && { repo, number, title: issue.title, body: issue.body, url: issue.url },
    events: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, at: e.createdAt, label: labelOf(e) })),
    runs,
    proofs: await loadProofs(payload, stored.id),
    mockups: await loadMockups(payload, stored.id),
    ...pulls,
    statementsUsed: await statementsUsed(payload, stored.id, events),
    deploy: deployOf(stored, events, pulls.pullRequest),
    answerRemembered: stored.card?.card === 'question' && isRemembered(stored.card.reason),
    similarItems: issue ? await similarItems(payload, issue.id, SIMILAR_LIMIT, 'issue') : [],
  }
}
