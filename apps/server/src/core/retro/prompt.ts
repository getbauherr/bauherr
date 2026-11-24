import { z } from 'zod'
import type { ChatTurn } from './model'
import { replySchema, RetroInvalid, type Opening, type Reply } from './schema'
import type { Message } from './store'
import type { TicketNote } from './history'

export type RetroContext = {
  label: string
  opening: Opening
  notes: TicketNote[]
  documents: { factory: string; workspace: string; product: string }
  files: Record<string, string>
}

export const OPEN_LINE = 'Open the Retro. The context as JSON follows.'
export const RETRY_LINE = 'Answer again as the one JSON object described in your instructions, and nothing else.'

export const openingTurn = (context: RetroContext): ChatTurn => ({
  role: 'user',
  content: `${OPEN_LINE}\n${JSON.stringify(context)}`,
})

export const turnsOf = (context: RetroContext, messages: Message[]): ChatTurn[] => [
  openingTurn(context),
  ...messages.map((message): ChatTurn =>
    message.role === 'owner'
      ? { role: 'user', content: message.body }
      : { role: 'assistant', content: message.parts?.raw ?? message.body },
  ),
]

export const parseReply = (raw: string): Reply => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const parsed = z.unknown().safeParse(start === -1 ? null : safeJson(raw.slice(start, end + 1)))
  const reply = replySchema.safeParse(parsed.success ? parsed.data : null)
  if (!reply.success) throw new RetroInvalid('The factory answered in a form I could not read.')
  return reply.data
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
