import type { Check, Comment, PullRequest, Ticket } from '@bauherr/adapters'

export type ItemRow = {
  kind: 'issue' | 'pr'
  number: number
  title: string
  body: string
  state: 'open' | 'closed' | 'merged'
  author: string
  authorTrusted: boolean
  authorIsBot: boolean
  labels: string[]
  assignees: string[]
  url: string
  forgeCreatedAt: string
  forgeUpdatedAt: string
  forgeClosedAt: string | null
  headSha: string | null
  headRef: string | null
  closes: number[]
  draft: boolean
}

export type CommentRow = {
  forgeId: string
  author: string
  body: string
  forgeCreatedAt: string
  forgeUpdatedAt: string
}

export type CheckRow = {
  sha: string
  name: string
  status: string
  conclusion: string | null
  url: string | null
  forgeUpdatedAt: string | null
}

export const itemFromTicket = (ticket: Ticket): ItemRow => ({
  kind: 'issue',
  number: ticket.number,
  title: ticket.title,
  body: ticket.body,
  state: ticket.state,
  author: ticket.author,
  authorTrusted: ticket.authorTrusted,
  authorIsBot: ticket.authorIsBot,
  labels: ticket.labels,
  assignees: ticket.assignees,
  url: ticket.url,
  forgeCreatedAt: ticket.createdAt,
  forgeUpdatedAt: ticket.updatedAt,
  forgeClosedAt: ticket.closedAt ?? null,
  headSha: null,
  headRef: null,
  closes: [],
  draft: false,
})

export const itemFromPull = (pull: PullRequest): ItemRow => ({
  kind: 'pr',
  number: pull.number,
  title: pull.title,
  body: pull.body,
  state: pull.state,
  author: pull.author,
  authorTrusted: pull.authorTrusted,
  authorIsBot: pull.authorIsBot,
  labels: pull.labels,
  assignees: pull.assignees,
  url: pull.url,
  forgeCreatedAt: pull.createdAt,
  forgeUpdatedAt: pull.updatedAt,
  forgeClosedAt: pull.closedAt ?? null,
  headSha: pull.headSha,
  headRef: pull.head,
  closes: pull.closes,
  draft: pull.draft,
})

export const commentRow = (comment: Comment): CommentRow => ({
  forgeId: comment.id,
  author: comment.author,
  body: comment.body,
  forgeCreatedAt: comment.createdAt,
  forgeUpdatedAt: comment.updatedAt,
})

export const checkRow = (sha: string, check: Check): CheckRow => ({
  sha,
  name: check.name,
  status: check.status,
  conclusion: check.conclusion,
  url: check.url ?? null,
  forgeUpdatedAt: check.startedAt ?? null,
})

export const takeBatch = <T extends { updatedAt: string }>(
  changes: T[],
  limit: number,
): { batch: T[]; truncated: boolean } => {
  const last = changes[limit - 1]
  if (!last || changes.length <= limit) return { batch: changes, truncated: false }
  const end = changes.findLastIndex((change) => change.updatedAt === last.updatedAt) + 1
  return { batch: changes.slice(0, end), truncated: end < changes.length }
}

export const lookbackFrom = (cursor: string, hours: number): string =>
  new Date(Date.parse(cursor) - hours * 3_600_000).toISOString()

export const isDue = (last: string | null, now: Date, everyMs: number): boolean =>
  last === null || now.getTime() - Date.parse(last) >= everyMs

export const laterOf = (a: string | null, b: string | null): string | null => {
  if (a === null || b === null) return a ?? b
  return Date.parse(a) >= Date.parse(b) ? a : b
}

export const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 1000)
