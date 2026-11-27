import type { CloseReason, Comment, NewPullRequest, PullRequest, Ticket } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { type Stage } from '../events'
import { bringUpToDate, type BranchUpdate } from './branch-update'
import { settleMerge } from './merge-pending'
import { edgeOf } from '../relations/proposal'
import { itemsByNumber } from '../relations/store'
import type { Edge } from '../relations/rules'
import type { RelationKind } from '../record/schema'
import { commentRow, itemFromPull, itemFromTicket } from '../mirror/map'
import { upsertComments, upsertItem } from '../mirror/store'
import { disclosed, hashBody, planStageLabels } from './disclosure'
import { releaseWrites } from './release-writes'
import { assertActive, HeadMoved, TargetNotFound } from './errors'
import { changeRelation, linkSeries } from './relation-writes'
import {
  defaultDeps,
  open,
  perform,
  ticketId,
  type Ctx,
  type Session,
  type WriteKind,
  type WriterDeps,
} from './write-session'
import {
  findIssueByReference,
  loadProductRow,
  saveClosed,
  saveHead,
  saveLabels,
  saveReopened,
  saveStatusComment,
  type ProductTarget,
  type Target,
} from './write-store'

export { defaultDeps }
export type { ProductTarget, Target, WriteKind, WriterDeps }
export type NewIssue = { title: string; body: string; reference: string }

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
  assertActive(row)
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
  assertActive(row)
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


export type SeriesIssue = NewIssue & { relations?: { type: RelationKind; with: number }[] }

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
