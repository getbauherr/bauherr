import { notFound } from 'next/navigation'
import type { Payload } from 'payload'
import { WriteError } from '../../../core/forge/errors'
import { createWriter } from '../../../core/forge/writer'
import type { ApplyDeps } from '../../../core/retro/apply'
import type { ConverseDeps } from '../../../core/retro/converse'
import { RetroError, RetroNotFound } from '../../../core/retro/schema'
import { MemoryError, type Who } from '../../../core/memory'
import { retroSkill } from '../../../lean'
import { ModelUnavailable, retroModel } from '../../../lib/retro-model'
import { factoryRepo } from '../../../lib/retro-settings'
import { currentWorkspace, payloadClient } from './session'

export type Held = { payload: Payload; who: Who }

export const held = async (): Promise<Held> => {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return notFound()
  return {
    payload: await payloadClient(),
    who: { person: { id: String(user.id), role: user.role, workspaceIds: [workspace.id] }, workspace: workspace.id },
  }
}

export const converseDeps = async (payload: Payload): Promise<ConverseDeps> => ({
  model: await retroModel(payload),
  skill: retroSkill,
  now: () => new Date(),
})

export const applyDeps = (payload: Payload): ApplyDeps => ({
  writer: createWriter(payload),
  factoryRepo: factoryRepo(),
})

export const failure = (error: unknown): { error: string } => {
  if (error instanceof RetroNotFound) return notFound()
  if (
    error instanceof RetroError ||
    error instanceof MemoryError ||
    error instanceof WriteError ||
    error instanceof ModelUnavailable
  ) {
    return { error: error.message }
  }
  throw error
}
