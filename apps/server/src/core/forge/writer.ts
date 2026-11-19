import type { Backend, CloseReason, Comment, Forge, TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { backendFor } from '../../lib/adapters'
import { connectionInput } from '../../lib/connection'
import { appendEvent } from '../record/store'
import { WRITE_KINDS, type Stage } from '../events'
import { upsertComments } from '../mirror/store'
import { commentRow, errorText } from '../mirror/map'
import { disclosed, hashBody, planStageLabels } from './disclosure'
import { HeadMoved, ProductObserving, WrongItemKind } from './errors'
import { loadWriteRow, saveClosed, saveLabels, saveStatusComment, type Target, type WriteRow } from './write-store'

export type WriteKind = (typeof WRITE_KINDS)[number]
export type WriterDeps = { backend: (connection: number) => Promise<Backend>; now: () => Date }
export type { Target }

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

const postQuestion = async (ctx: Ctx, target: Target, body: string): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, 'question', session, {
    call: ({ tickets, row }) => tickets.comment(ticketId(row), disclosed(body)),
    mirror: (current, comment) => mirrorComment(ctx, current, target, comment),
  })
}

const mergePullRequest = async (ctx: Ctx, target: Target, expectedHeadSha: string): Promise<void> => {
  const session = await open(ctx, target, 'pr')
  await perform(ctx, target, 'merge', session, {
    call: async ({ forge, row }) => {
      const pull = await forge.getPullRequest(row.repo, row.number)
      if (pull.headSha !== expectedHeadSha) {
        throw new HeadMoved(`${row.repo}#${row.number} head is ${pull.headSha}, not ${expectedHeadSha}.`)
      }
      return forge.mergePullRequest(row.repo, row.number, { method: 'squash', expectSha: expectedHeadSha })
    },
    mirror: () => saveClosed(ctx.payload, target.itemId, 'merged', ctx.deps.now()),
  })
}

const closeIssue = async (ctx: Ctx, target: Target, reason: CloseReason): Promise<void> => {
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, 'close', session, {
    call: ({ tickets, row }) => tickets.close(ticketId(row), reason),
    mirror: () => saveClosed(ctx.payload, target.itemId, 'closed', ctx.deps.now()),
  })
}

export const createWriter = (payload: Payload, deps: WriterDeps = defaultDeps(payload)) => {
  const ctx: Ctx = { payload, deps }
  return {
    setStageLabel: (target: Target, stage: Stage) => setStageLabel(ctx, target, stage),
    upsertStatusComment: (target: Target, body: string) => upsertStatusComment(ctx, target, body),
    postQuestion: (target: Target, body: string) => postQuestion(ctx, target, body),
    mergePullRequest: (target: Target, expectedHeadSha: string) => mergePullRequest(ctx, target, expectedHeadSha),
    closeIssue: (target: Target, reason: CloseReason) => closeIssue(ctx, target, reason),
  }
}

export type ForgeWriter = ReturnType<typeof createWriter>
