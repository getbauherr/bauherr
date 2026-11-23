'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { archive, restore } from '../../../../core/archive'
import { DecisionError } from '../../../../core/decide'
import { RecordNotFound } from '../../../../core/record/errors'
import { engineDeps } from '../../../../jobs/engine-deps'
import { personOf } from '../../../../lib/person'
import { currentWorkspace, payloadClient } from '../../lib/session'

const input = z.object({ recordId: z.number().int().positive() })

export type ArchiveResult = { error?: string }

const change = (work: typeof archive) => async (raw: unknown): Promise<ArchiveResult> => {
  const { user, workspace } = await currentWorkspace()
  const parsed = input.safeParse(raw)
  if (!workspace || !parsed.success) return notFound()
  const person = { id: String(user.id), role: user.role, workspaceIds: [workspace.id], name: personOf(user) }
  try {
    await work(parsed.data.recordId, person, engineDeps(await payloadClient()))
  } catch (error) {
    if (error instanceof RecordNotFound) return notFound()
    if (!(error instanceof DecisionError)) throw error
    return { error: error.message }
  }
  revalidatePath(`/tickets/${parsed.data.recordId}`)
  revalidatePath('/inbox')
  return {}
}

export async function archiveTicket(raw: unknown): Promise<ArchiveResult> {
  return change(archive)(raw)
}

export async function restoreTicket(raw: unknown): Promise<ArchiveResult> {
  return change(restore)(raw)
}
