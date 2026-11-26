import type {
  Backend,
  CloseReason,
  Comment,
  Forge,
  NewPullRequest,
  PullRequest,
  Ticket,
  TicketSource,
} from '@bauherr/adapters'
import type { Payload } from 'payload'
import { backendFor } from '../../lib/adapters'
import { connectionInput } from '../../lib/connection'
import { appendEvent } from '../record/store'
import { WRITE_KINDS, type Stage } from '../events'
import { bringUpToDate, type BranchUpdate } from './branch-update'
import { settleMerge } from './merge-pending'
import { checkNewRelation } from '../relations/relate'
import { edgeOf } from '../relations/proposal'
import { syncForgeLink } from '../relations/forge-link'
import { normalised, type Edge } from '../relations/rules'
import { deleteEdge, insertEdge, itemFacts, itemsByNumber } from '../relations/store'
import { RelationRefused, typeOf } from '../relations/types'
import type { RelationKind } from '../record/schema'
import { commentRow, errorText, itemFromPull, itemFromTicket } from '../mirror/map'
import { upsertComments, upsertItem } from '../mirror/store'
import { disclosed, hashBody, planStageLabels } from './disclosure'
import { releaseWrites } from './release-writes'
import { HeadMoved, ProductObserving, TargetNotFound, WrongItemKind } from './errors'
import {
  findIssueByReference,
  loadProductRow,
  loadWriteRow,
  saveClosed,
  saveHead,
  saveLabels,
  saveReopened,
  saveStatusComment,
  type ProductTarget,
  type Target,
  type WriteRow,
} from './write-store'

export type WriteKind = (typeof WRITE_KINDS)[number]
export type WriterDeps = { backend: (connection: number) => Promise<Backend>; now: () => Date }
export type { ProductTarget, Target }
export type NewIssue = { title: string; body: string; reference: string }

type Ctx = { payload: Payload; deps: WriterDeps }
type Session = { row: WriteRow; tickets: TicketSource; forge: Forge }
type Step<T> = { call: (session: Session) => Promise<T>; mirror: (session: Session, result: T) => Promise<void> }

const ticketId = (row: WriteRow): string => String(row.number)
const place = (row: WriteRow) => ({ repo: row.repo, number: row.number })

export const defaultDeps = (payload: Payload): WriterDeps => ({
  backend: async (connection) => backendFor(await connectionInput(payload, connection)),
  now: () => new Date(),
})

const open = async (ctx: Ctx, target: Target, kind: 'issue' | 'pr'): Promise<Session> => {
  const row = await loadWriteRow(ctx.payload, target)
  if (row.productState !== 'active') {
    throw new ProductObserving(`Product ${row.productName} is observing: nothing is written to the forge.`)
  }
  if (row.kind !== kind) {
    throw new WrongItemKind(`${row.repo}#${row.number} is a ${row.kind}: this write needs a ${kind}.`)
  }
  const backend = await ctx.deps.backend(row.connection)
  return { row, tickets: backend.tickets(row.repo), forge: backend.forge }
}

const perform = async <T>(ctx: Ctx, target: Target, kind: WriteKind, session: Session, step: Step<T>): Promise<T> => {
  const data = { kind, target: place(session.row) }
  const append = (event: Parameters<typeof appendEvent>[2]) => appendEvent(ctx.payload, target.recordId, event)
  await append({ type: 'forge.write.started', data, actor: 'factory' })
  let result: T
  try {
    result = await step.call(session)
  } catch (error) {
    await append({ type: 'forge.write.failed', data: { ...data, reason: errorText(error) }, actor: 'factory' })
    throw error
  }
  await append({ type: 'forge.write.done', data, actor: 'factory' })
  await step.mirror(session, result)
  return result
}

const mirrorComment = (ctx: Ctx, session: Session, target: Target, comment: Comment) =>
  upsertComments(ctx.payload, session.row.workspace, target.itemId, [commentRow(comment)])

const setStageLabel = async (ctx: Ctx, target: Target, stage: Stage): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, 'stage-label', session, {
    call: async ({ tickets, row }) => {
      const plan = planStageLabels((await tickets.get(ticketId(row))).labels, stage)
      if (plan.add.length > 0) await tickets.addLabels(ticketId(row), plan.add)
      if (plan.remove.length > 0) await tickets.removeLabels(ticketId(row), plan.remove)
      return plan.next
    },
    mirror: (_session, labels) => saveLabels(ctx.payload, target.itemId, labels),
  })
}

const upsertStatusComment = async (ctx: Ctx, target: Target, body: string): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  const text = disclosed(body)
  const hash = hashBody(text)
  const { statusCommentId, statusCommentHash } = session.row
  if (statusCommentId !== null && statusCommentHash === hash) return
  await perform(ctx, target, 'status-comment', session, {
    call: ({ tickets, row }) =>
      statusCommentId === null
        ? tickets.comment(ticketId(row), text)
        : tickets.updateComment(ticketId(row), statusCommentId, text),
    mirror: async (current, comment) => {
      await saveStatusComment(ctx.payload, target.recordId, comment.id, hash)
      await mirrorComment(ctx, current, target, comment)
    },
  })
}

const commentOnTicket = async (ctx: Ctx, target: Target, input: { key: string; body: string }): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  const marker = `<!-- bauherr:comment:${input.key} -->`
  const earlier = await session.tickets.listComments(ticketId(session.row))
  if (earlier.some((comment) => comment.body.includes(marker))) return
  await perform(ctx, target, 'comment', session, {
    call: ({ tickets, row }) => tickets.comment(ticketId(row), `${disclosed(input.body)}\n\n${marker}`),
    mirror: (current, comment) => mirrorComment(ctx, current, target, comment),
  })
}

const postQuestion = async (ctx: Ctx, target: Target, body: string): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, 'question', session, {
    call: ({ tickets, row }) => tickets.comment(ticketId(row), disclosed(body)),
    mirror: (current, comment) => mirrorComment(ctx, current, target, comment),
  })
}

const mergePullRequest = async (ctx: Ctx, target: Target, expectedHeadSha: string): Promise<string> => {
  const session = await open(ctx, target, 'pr')
  const merged = await perform(ctx, target, 'merge', session, {
    call: async ({ forge, row }) => {
      const pull = await forge.getPullRequest(row.repo, row.number)
      if (pull.headSha !== expectedHeadSha) {
        throw new HeadMoved(`${row.repo}#${row.number} head is ${pull.headSha}, not ${expectedHeadSha}.`)
      }
      return forge
        .mergePullRequest(row.repo, row.number, { method: 'squash', expectSha: expectedHeadSha })
        .catch((error: unknown) => settleMerge(forge, row.repo, row.number, error))
    },
    mirror: () => saveClosed(ctx.payload, target.itemId, 'merged', ctx.deps.now()),
  })
  return merged.mergeSha
}

const updatePullRequestBranch = async (ctx: Ctx, target: Target, retarget: boolean): Promise<BranchUpdate> => {
  const session = await open(ctx, target, 'pr')
  return perform(ctx, target, 'update-branch', session, {
    call: ({ forge, row }) => bringUpToDate(forge, row.repo, row.number, retarget),
    mirror: async (_session, update) => {
      if (update.kind === 'updated') await saveHead(ctx.payload, target.itemId, update.headSha)
    },
  })
}

const openPullRequest = async (ctx: Ctx, target: Target, input: NewPullRequest): Promise<PullRequest> => {
  const session = await open(ctx, target, 'issue')
  return perform(ctx, target, 'pull-request', session, {
    call: ({ forge, row }) => forge.openPullRequest(row.repo, { ...input, body: disclosed(input.body ?? '') }),
    mirror: async ({ row }, pull) => {
      const { workspace, product, source, repo } = row
      await upsertItem(ctx.payload, { workspace, product, source, repo }, itemFromPull(pull), ctx.deps.now())
    },
  })
}

const reviewPullRequest = async (ctx: Ctx, target: Target, body: string): Promise<void> => {
  const session = await open(ctx, target, 'pr')
  await perform(ctx, target, 'review', session, {
    call: ({ forge, row }) => forge.reviewPullRequest(row.repo, row.number, { body: disclosed(body), comments: [] }),
    mirror: (current, comment) => mirrorComment(ctx, current, target, comment),
  })
}

const openIssue = async (ctx: Ctx, target: ProductTarget, input: NewIssue): Promise<Ticket> => {
  const row = await loadProductRow(ctx.payload, target)
  if (row.productState !== 'active') {
    throw new ProductObserving(`Product ${row.productName} is observing: nothing is written to the forge.`)
  }
  const tickets = (await ctx.deps.backend(row.connection)).tickets(row.repo)
  const reference = `Reference: ${input.reference}`
  const earlier = await findIssueByReference(ctx.payload, { source: row.source, reference })
  const issue = earlier
    ? await tickets.get(earlier)
    : await tickets.create({ title: input.title, body: disclosed(`${input.body}\n\n${reference}`) })
  const { source, repo } = row
  await upsertItem(ctx.payload, { ...target, source, repo }, itemFromTicket(issue), ctx.deps.now())
  return issue
}

const commentOnIssue = async (ctx: Ctx, target: ProductTarget, number: number, body: string): Promise<void> => {
  const row = await loadProductRow(ctx.payload, target)
  if (row.productState !== 'active') {
    throw new ProductObserving(`Product ${row.productName} is observing: nothing is written to the forge.`)
  }
  await (await ctx.deps.backend(row.connection)).tickets(row.repo).comment(String(number), disclosed(body))
}

const closeIssue = async (ctx: Ctx, target: Target, reason: CloseReason): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, 'close', session, {
    call: ({ tickets, row }) => tickets.close(ticketId(row), reason),
    mirror: () => saveClosed(ctx.payload, target.itemId, 'closed', ctx.deps.now()),
  })
}

const reopenIssue = async (ctx: Ctx, target: Target): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, 'reopen', session, {
    call: ({ tickets, row }) => tickets.reopen(ticketId(row)),
    mirror: () => saveReopened(ctx.payload, target.itemId),
  })
}

const relationEnds = async (ctx: Ctx, input: Edge) => {
  const type = typeOf(input.type)
  const edge = normalised(input, type)
  const facts = await itemFacts(ctx.payload, [edge.from, edge.to])
  const from = facts.get(edge.from)
  const to = facts.get(edge.to)
  if (!from || !to) throw new TargetNotFound(`Tickets ${edge.from} and ${edge.to} must both be mirrored.`)
  return { type, edge, from, to }
}

const changeRelation = async (ctx: Ctx, recordId: number, input: Edge, change: 'add' | 'remove'): Promise<void> => {
  const { type, edge, from, to } = await relationEnds(ctx, input)
  if (change === 'add') await checkNewRelation(ctx.payload, from.workspace, edge)
  const save = () =>
    change === 'add' ? insertEdge(ctx.payload, from.workspace, edge) : deleteEdge(ctx.payload, edge)
  const { forge } = type
  if (!forge) return save()
  if (from.repo !== to.repo) {
    throw new RelationRefused(`"${type.key}" is kept on the forge, which links tickets of one repository only.`)
  }
  const [mine, other] = forge.ticketIs === 'to' ? [to, from] : [from, to]
  const target = { recordId, itemId: mine.id }
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, change === 'add' ? 'relation-add' : 'relation-remove', session, {
    call: ({ tickets }) => {
      const link = { field: forge.field, mine: mine.number, other: other.number }
      return syncForgeLink(tickets, type, link, change)
    },
    mirror: save,
  })
}

export type SeriesIssue = NewIssue & { relations?: { type: RelationKind; with: number }[] }

const linkSeries = async (ctx: Ctx, tickets: TicketSource, input: Edge): Promise<void> => {
  const { type, edge, from, to } = await relationEnds(ctx, input)
  await checkNewRelation(ctx.payload, from.workspace, edge)
  if (type.forge) {
    const [mine, other] = type.forge.ticketIs === 'to' ? [to, from] : [from, to]
    await syncForgeLink(tickets, type, { field: type.forge.field, mine: mine.number, other: other.number }, 'add')
  }
  await insertEdge(ctx.payload, from.workspace, edge)
}

const openIssues = async (ctx: Ctx, target: ProductTarget, inputs: SeriesIssue[]): Promise<Ticket[]> => {
  const issues: Ticket[] = []
  for (const input of inputs) issues.push(await openIssue(ctx, target, input))
  const row = await loadProductRow(ctx.payload, target)
  const numbers = issues.map((issue) => issue.number)
  const ids = await itemsByNumber(ctx.payload, target.workspace, row.repo, numbers)
  const tickets = (await ctx.deps.backend(row.connection)).tickets(row.repo)
  const itemAt = (index: number) => ids.get(numbers[index] ?? 0)
  for (const [index, input] of inputs.entries()) {
    for (const relation of input.relations ?? []) {
      const [self, other] = [itemAt(index), itemAt(relation.with)]
      if (self === undefined || other === undefined) {
        throw new TargetNotFound(`Series tickets ${index} and ${relation.with} must both be mirrored.`)
      }
      await linkSeries(ctx, tickets, edgeOf(relation.type, self, other))
    }
  }
  return issues
}

export const createWriter = (payload: Payload, deps: WriterDeps = defaultDeps(payload)) => {
  const ctx: Ctx = { payload, deps }
  return {
    setStageLabel: (target: Target, stage: Stage) => setStageLabel(ctx, target, stage),
    upsertStatusComment: (target: Target, body: string) => upsertStatusComment(ctx, target, body),
    postQuestion: (target: Target, body: string) => postQuestion(ctx, target, body),
    commentOnTicket: (target: Target, input: { key: string; body: string }) => commentOnTicket(ctx, target, input),
    mergePullRequest: (target: Target, expectedHeadSha: string) => mergePullRequest(ctx, target, expectedHeadSha),
    updatePullRequestBranch: (target: Target, retarget: boolean) => updatePullRequestBranch(ctx, target, retarget),
    openPullRequest: (target: Target, input: NewPullRequest) => openPullRequest(ctx, target, input),
    reviewPullRequest: (target: Target, body: string) => reviewPullRequest(ctx, target, body),
    openIssue: (target: ProductTarget, input: NewIssue) => openIssue(ctx, target, input),
    commentOnIssue: (target: ProductTarget, number: number, body: string) =>
      commentOnIssue(ctx, target, number, body),
    openIssues: (target: ProductTarget, inputs: SeriesIssue[]) => openIssues(ctx, target, inputs),
    closeIssue: (target: Target, reason: CloseReason) => closeIssue(ctx, target, reason),
    reopenIssue: (target: Target) => reopenIssue(ctx, target),
    ...releaseWrites(ctx.payload, ctx.deps),
    addRelation: (recordId: number, edge: Edge) => changeRelation(ctx, recordId, edge, 'add'),
    removeRelation: (recordId: number, edge: Edge) => changeRelation(ctx, recordId, edge, 'remove'),
  }
}

export type ForgeWriter = ReturnType<typeof createWriter>
