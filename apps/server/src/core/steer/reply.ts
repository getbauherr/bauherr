import { z } from 'zod'
import { NOTE_MAX } from '../limits'

export const ANSWER = 'answer'
export const COMMENT_TO_AGENT = 'comment_to_agent'

const SAY_MAX = 1500

const replySchema = z.object({
  say: z.string().trim().max(SAY_MAX).default(''),
  tool: z.string().trim().min(1).default(ANSWER),
  note: z.string().trim().max(NOTE_MAX).optional(),
  criteria: z.array(z.string().trim().min(1)).optional(),
})

export type SteerReply = z.infer<typeof replySchema>

export const parseReply = (raw: string): SteerReply => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const plain: SteerReply = { say: raw.trim().slice(0, SAY_MAX), tool: ANSWER }
  if (start < 0 || end < start) return plain
  try {
    const parsed = replySchema.safeParse(JSON.parse(raw.slice(start, end + 1)))
    return parsed.success ? parsed.data : plain
  } catch {
    return plain
  }
}
