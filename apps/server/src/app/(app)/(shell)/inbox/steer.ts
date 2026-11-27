'use server'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { MESSAGE_TEXT_MAX } from '../../../../core/conversations/limits'
import { mayDecide } from '../../../../core/decide'
import { RecordNotFound } from '../../../../core/record/errors'
import { requestConversation } from '../../../../core/requests/comments'
import { steerTurn, type SteerOutcome } from '../../../../core/steer/turn'
import { requestScope } from '../../../../core/views/request-access'
import { personOf } from '../../../../lib/person'
import { steerModel } from '../../../../lib/steer-model'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { commentOnRequestAction } from '../requests/actions'

const input = z.object({
  recordId: z.number().int().positive(),
  text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX),
})

export type SteerResult = { error?: string; outcome?: SteerOutcome }

export async function steerTicket(raw: unknown): Promise<SteerResult> {
  const { user, workspace } = await currentWorkspace()
  const parsed = input.safeParse(raw)
  if (!workspace || !parsed.success) return notFound()
  const { recordId, text } = parsed.data
  const payload = await payloadClient()
  const person = { id: String(user.id), role: user.role, workspaceIds: [workspace.id], name: personOf(user) }
  const scope = await requestScope(payload, recordId)
  if (scope?.workspace !== workspace.id || !mayDecide(person, workspace.id)) return notFound()
  const comment = async (said: string): Promise<string | null> =>
    (
      await commentOnRequestAction({
        recordId,
        conversationId: await requestConversation(payload, workspace.id, recordId),
        text: said,
        fileIds: [],
      })
    ).error ?? null
  try {
    const deps = { model: await steerModel(payload), comment }
    return { outcome: await steerTurn(payload, deps, { workspace: workspace.id, recordId, text }) }
  } catch (error) {
    if (error instanceof RecordNotFound) return notFound()
    throw error
  }
}
