'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { decide, DecisionError, StaleDecision, type Decision } from '../../../../core/decide'
import { RecordNotFound } from '../../../../core/record/errors'
import { engineDeps } from '../../../../jobs/engine-deps'
import { STALE_SENTENCE } from '../../lib/ticket-words'
import { currentWorkspace, payloadClient } from '../../lib/session'

const input = z.object({
  recordId: z.number().int().positive(),
  ask: z.string().min(1),
  choice: z.string().min(1),
  seq: z.number().int().min(0),
  note: z.string().optional(),
  answers: z.record(z.string(), z.string()).optional(),
})

export type DecisionResult = { error?: string }

const decisionOf = (given: z.infer<typeof input>): Decision => ({
  ask: given.ask,
  choice: given.choice,
  seq: given.seq,
  ...(given.note === undefined ? {} : { note: given.note }),
  ...(given.answers === undefined ? {} : { answers: given.answers }),
})

export async function decideTicket(raw: unknown): Promise<DecisionResult> {
  const { user, workspace } = await currentWorkspace()
  const parsed = input.safeParse(raw)
  if (!workspace || !parsed.success) return notFound()
  const person = { id: String(user.id), role: user.role, workspaceIds: [workspace.id] }
  try {
    await decide(parsed.data.recordId, person, decisionOf(parsed.data), engineDeps(await payloadClient()))
  } catch (error) {
    if (error instanceof RecordNotFound) return notFound()
    if (!(error instanceof DecisionError)) throw error
    return { error: error instanceof StaleDecision ? STALE_SENTENCE : error.message }
  }
  revalidatePath(`/tickets/${parsed.data.recordId}`)
  return {}
}
