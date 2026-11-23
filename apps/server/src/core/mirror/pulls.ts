import type { PullRequest } from '@bauherr/adapters'
import type { Payload } from 'payload'
import type { ReadForge, ReadTickets } from '../forge/reader'
import { checkRow, itemFromPull, itemFromTicket, type ItemRow } from './map'
import { pullsAwaitingMergeability, saveMergeability, type AwaitingMerge } from './merge-store'
import {
  clearGone,
  goneNumbers,
  knownItems,
  openItems,
  pullsAwaitingChecks,
  pullsAwaitingDeploy,
  setGone,
  upsertChecks,
  upsertItem,
  type ItemContext,
  type KnownItem,
} from './store'

export const BATCH = 50
const PAGE = 50
const RECONCILE_PAGE = 100

export const isCurrent = (known: KnownItem | undefined, updatedAt: string): boolean =>
  known !== undefined && !known.gone && known.updatedMs === Date.parse(updatedAt)

export type PullContext = ItemContext & { now: Date }

export const storePull = async (payload: Payload, context: PullContext, forge: ReadForge, pull: PullRequest) => {
  const item = await upsertItem(payload, context, itemFromPull(pull), context.now)
  if (pull.headSha === '') return
  const checks = await forge.listChecks(context.repo, pull.headSha)
  await upsertChecks(payload, context.workspace, item, checks.map((check) => checkRow(pull.headSha, check)))
}

export const syncDeployChecks = async (
  payload: Payload,
  context: PullContext,
  forge: ReadForge,
  number: number | null = null,
): Promise<void> => {
  for (const { itemId, sha } of await pullsAwaitingDeploy(payload, context.source, number)) {
    const checks = await forge.listChecks(context.repo, sha)
    await upsertChecks(payload, context.workspace, itemId, checks.map((check) => checkRow(sha, check)))
    context.touched?.add(itemId)
  }
}

const mergeCheckOf = (headSha: string, baseSha: string): string => `${headSha}@${baseSha}`

const readMergeability = async (
  payload: Payload,
  context: PullContext,
  forge: ReadForge,
  pull: AwaitingMerge,
  baseSha: string,
): Promise<void> => {
  const read = await forge.getPullRequest(context.repo, pull.number)
  const check = read.mergeable === undefined ? null : mergeCheckOf(read.headSha, baseSha)
  await saveMergeability(payload, pull.itemId, check, read.mergeable === false ? read.headSha : null)
  context.touched?.add(pull.itemId)
}

export const syncMergeability = async (payload: Payload, context: PullContext, forge: ReadForge): Promise<void> => {
  const bases = new Map<string, string | null>()
  for (const pull of await pullsAwaitingMergeability(payload, context.source)) {
    if (!bases.has(pull.baseRef)) {
      bases.set(pull.baseRef, (await forge.getBranch(context.repo, pull.baseRef))?.sha ?? null)
    }
    const baseSha = bases.get(pull.baseRef) ?? null
    if (baseSha === null || pull.checked === mergeCheckOf(pull.headSha, baseSha)) continue
    await readMergeability(payload, context, forge, pull, baseSha)
  }
}

export const syncPulls = async (
  payload: Payload,
  context: PullContext,
  forge: ReadForge,
  imported: boolean,
): Promise<{ stored: number; fresh: number }> => {
  const pending = await pullsAwaitingChecks(payload, context.source)
  let stored = 0
  let fresh = 0
  for (let page = 1; ; page++) {
    const pulls = await forge.listOpenPullRequests(context.repo, page, PAGE)
    const known = await knownItems(payload, context.source, pulls.map((pull) => pull.number))
    const changed = pulls.filter(
      (pull) => pending.has(pull.number) || !isCurrent(known.get(pull.number), pull.updatedAt),
    )
    for (const pull of changed.slice(0, BATCH - stored)) {
      await storePull(payload, context, forge, pull)
      stored++
      if (!isCurrent(known.get(pull.number), pull.updatedAt)) fresh++
    }
    if (stored >= BATCH || pulls.length < PAGE || (imported && changed.length === 0)) return { stored, fresh }
  }
}

const refreshIssue = async (payload: Payload, context: PullContext, tickets: ReadTickets, number: number) => {
  const row: ItemRow = itemFromTicket(await tickets.get(String(number)))
  await upsertItem(payload, context, row, context.now)
}

const refreshPull = async (payload: Payload, context: PullContext, forge: ReadForge, number: number) => {
  await storePull(payload, context, forge, await forge.getPullRequest(context.repo, number))
}

const openOnForge = async (tickets: ReadTickets, forge: ReadForge, repo: string): Promise<Set<number>> => {
  const open = new Set((await tickets.list({ state: 'open' })).map((ticket) => ticket.number))
  for (let page = 1; ; page++) {
    const pulls = await forge.listOpenPullRequests(repo, page, RECONCILE_PAGE)
    for (const pull of pulls) open.add(pull.number)
    if (pulls.length < RECONCILE_PAGE) return open
  }
}

export const reconcile = async (
  payload: Payload,
  context: PullContext,
  reader: { tickets: ReadTickets; forge: ReadForge },
): Promise<void> => {
  const open = await openOnForge(reader.tickets, reader.forge, context.repo)
  for (const number of await goneNumbers(payload, context.source)) {
    if (open.has(number)) await clearGone(payload, context.source, number)
  }
  for (const item of await openItems(payload, context.source)) {
    if (open.has(item.number)) continue
    try {
      if (item.kind === 'pr') await refreshPull(payload, context, reader.forge, item.number)
      else await refreshIssue(payload, context, reader.tickets, item.number)
    } catch {
      await setGone(payload, context.source, item.number, context.now)
    }
  }
}
