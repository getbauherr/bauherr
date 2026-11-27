import type { ThreadMessageLike } from '@assistant-ui/react'
import type { ConversationMessage } from '../../../core/conversations/store'
import { resolveMention, type TicketRefs } from '../../../core/views/refs'
import type { TicketView } from '../../../core/views/ticket'
import { decisionOf, type DecisionModel, type DecisionSource } from './inbox-decision'
import { ticketPath, type InboxEntry } from './inbox-entries'
import { SUGGESTIONS } from './inbox-words'
import { ago } from './format'
import { INTENT_TOOL } from './inbox-steer'
import { CLOSED_WORDS, STATUS_WORDS } from './status-words'

export const DECISION_TOOL = 'decision'
export const DECIDED_LIMIT = 8

export type ThreadSource = DecisionSource &
  Pick<TicketView, 'title' | 'status' | 'closedAs' | 'events' | 'comments'>

export type Suggestion = { title: string; prompt: string }

export type ThreadModel = {
  id: string
  recordId: number | null
  number: number | null
  title: string
  href: string | null
  view: Pick<TicketView, 'status' | 'closedAs'> | null
  messages: ThreadMessageLike[]
  decision: DecisionModel | null
  suggestions: Suggestion[]
}

export const linkRefs = (text: string, repo: string, refs: TicketRefs): string =>
  text.replace(/(?<![\w/&`])#(\d+)/g, (match, digits: string) => {
    const ticket = resolveMention(refs, repo, Number(digits), '#')
    return ticket ? `[\`${match}\`](${ticketPath(ticket.recordId)})` : match
  })

export const assistantText = (id: string, text: string): ThreadMessageLike => ({
  id,
  role: 'assistant',
  status: { type: 'complete', reason: 'stop' },
  content: [{ type: 'text', text }],
})

export const userText = (id: string, text: string): ThreadMessageLike => ({
  id,
  role: 'user',
  content: [{ type: 'text', text }],
})

const SKIPPED = ['request.commented']

export const decidedBefore = (view: ThreadSource): string[] =>
  view.events
    .filter((event) => event.actor === 'owner' && !SKIPPED.includes(event.type))
    .slice(-DECIDED_LIMIT)
    .map((event) => `${ago(event.at)}: ${event.label.replace(/^The owner/, 'You')}`)

const decidedMessage = (view: ThreadSource): ThreadMessageLike[] => {
  const lines = decidedBefore(view)
  if (lines.length === 0) return []
  const text = ['**What you decided before**', ...lines.map((line) => `- ${line}`)].join('\n')
  return [assistantText(`decided-${view.recordId}`, text)]
}

type Timed = { at: string; message: ThreadMessageLike }

const commentMessages = (view: ThreadSource): Timed[] =>
  view.comments.map((comment) => ({
    at: comment.at,
    message:
      comment.role === 'bauherr'
        ? userText(`comment-${comment.id}`, comment.text)
        : assistantText(`comment-${comment.id}`, `**${comment.author}**: ${comment.text}`),
  }))

const steerMessages = (steer: ConversationMessage[]): Timed[] =>
  steer.map((item) => ({
    at: item.createdAt,
    message: (item.role === 'user' ? userText : assistantText)(`steer-${item.id}`, item.text),
  }))

const timeline = (view: ThreadSource, steer: ConversationMessage[]): ThreadMessageLike[] =>
  [...commentMessages(view), ...steerMessages(steer)]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((item) => item.message)

const statusMessage = (view: ThreadSource): ThreadMessageLike => {
  const word = view.closedAs ? CLOSED_WORDS[view.closedAs] : STATUS_WORDS[view.status].word
  return assistantText(`status-${view.recordId}`, `${word}. Nothing needs you right now.`)
}

export const intentMessage = (args: { key: string; recordId: number; number: number }): ThreadMessageLike => ({
  id: `intent-${args.key}`,
  role: 'assistant',
  status: { type: 'complete', reason: 'stop' },
  content: [{ type: 'tool-call', toolCallId: `call-intent-${args.key}`, toolName: INTENT_TOOL, args }],
})

export const decisionMessage = (decision: DecisionModel): ThreadMessageLike => ({
  id: `ask-${decision.key}`,
  role: 'assistant',
  status: { type: 'complete', reason: 'stop' },
  content: [{ type: 'tool-call', toolCallId: `call-${decision.key}`, toolName: DECISION_TOOL, args: decision }],
})

export const threadOf = (view: ThreadSource, refs: TicketRefs, steer: ConversationMessage[] = []): ThreadModel => {
  const decision = decisionOf(view)
  const { repo } = view.record.source
  const linked = (message: ThreadMessageLike): ThreadMessageLike =>
    message.role === 'assistant' && typeof message.content !== 'string'
      ? {
          ...message,
          content: message.content.map((part) =>
            part.type === 'text' ? { ...part, text: linkRefs(part.text, repo, refs) } : part,
          ),
        }
      : message
  const body = [...decidedMessage(view), ...(decision ? [] : [statusMessage(view)]), ...timeline(view, steer)]
  return {
    id: String(view.recordId),
    recordId: view.recordId,
    number: view.number,
    title: view.title,
    href: ticketPath(view.recordId),
    view: { status: view.status, closedAs: view.closedAs },
    messages: [...body.map(linked), ...(decision ? [decisionMessage(decision)] : [])],
    decision,
    suggestions: decision ? SUGGESTIONS : [],
  }
}

const SESSION_NOTE = '{who} is connected{work}. You can steer the ticket it works on from here.'

export const sessionThread = (entry: InboxEntry): ThreadModel => {
  const work = entry.tickets.length === 0 ? '' : ` and works on ${entry.tickets.map((t) => `#${t.number}`).join(', ')}`
  const text = SESSION_NOTE.replace('{who}', entry.title).replace('{work}', work)
  const linked = entry.tickets.reduce(
    (acc, t) => acc.replace(`#${t.number}`, `[\`#${t.number}\`](${ticketPath(t.recordId)})`),
    text,
  )
  return {
    id: entry.id,
    recordId: null,
    number: null,
    title: entry.title,
    href: null,
    view: null,
    messages: [assistantText(`note-${entry.id}`, linked)],
    decision: null,
    suggestions: [],
  }
}

export const emptyThread = (): ThreadModel => ({
  id: 'none',
  recordId: null,
  number: null,
  title: 'Inbox',
  href: null,
  view: null,
  messages: [assistantText('note-none', 'Nothing needs you. The factory asks again when it does.')],
  decision: null,
  suggestions: [],
})

export const unreadableThread = (entry: InboxEntry | undefined): ThreadModel => ({
  ...emptyThread(),
  id: entry?.id ?? 'none',
  title: entry?.title ?? 'Inbox',
  href: entry?.href ?? null,
  number: entry?.number ?? null,
  recordId: null,
  messages: [assistantText('note-unreadable', 'This ticket could not be read. Open it to see what is wrong.')],
})
