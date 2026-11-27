'use server'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { appendMessage } from '../../../../core/conversations/store'
import { MESSAGE_TEXT_MAX } from '../../../../core/conversations/limits'
import { mayDecide } from '../../../../core/decide'
import { RecordNotFound } from '../../../../core/record/errors'
import { requestConversation } from '../../../../core/requests/comments'
import { steerConversation } from '../../../../core/steer/store'
import { steerTurn, UNDONE_NOTE, type SteerOutcome } from '../../../../core/steer/turn'
import { requestScope } from '../../../../core/views/request-access'
import { personOf } from '../../../../lib/person'
import { steerModel } from '../../lib/steer-model'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { commentOnRequestAction } from '../requests/actions'

const input = z.object({
  recordId: z.number().int().positive(),
  text: z.string().trim().min(1).max(MESSAGE_TEXT_MAX),
})

export type SteerResult = { error?: string; outcome?: SteerOutcome }

const allowed = async (recordId: number) => {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return notFound()
  const payload = await payloadClient()
  const person = { id: String(user.id), role: user.role, workspaceIds: [workspace.id], name: personOf(user) }
  const scope = await requestScope(payload, recordId)
  if (scope?.workspace !== workspace.id || !mayDecide(person, workspace.id)) return notFound()
  return { payload, workspace: workspace.id }
}

export async function steerTicket(raw: unknown): Promise<SteerResult> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) return notFound()
  const { recordId, text } = parsed.data
  const { payload, workspace } = await allowed(recordId)
  const comment = async (said: string): Promise<string | null> =>
    (
      await commentOnRequestAction({
        recordId,
        conversationId: await requestConversation(payload, workspace, recordId),
        text: said,
        fileIds: [],
      })
    ).error ?? null
  try {
    const deps = { model: await steerModel(payload), comment }
    return { outcome: await steerTurn(payload, deps, { workspace, recordId, text }) }
  } catch (error) {
    if (error instanceof RecordNotFound) return notFound()
    throw error
  }
}

export async function noteUndone(raw: unknown): Promise<void> {
  const parsed = z.number().int().positive().safeParse(raw)
  if (!parsed.success) return notFound()
  const { payload, workspace } = await allowed(parsed.data)
  const conversationId = await steerConversation(payload, workspace, parsed.data)
  await appendMessage(payload, { workspace, conversationId, role: 'assistant', text: UNDONE_NOTE, fileIds: [] })
}
