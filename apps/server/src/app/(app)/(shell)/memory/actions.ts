'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { MemoryError, MemoryNotFound, memoryInput, type Who } from '../../../../core/memory'
import { addMemory, deleteMemory, saveMemory, setMemoryOff } from '../../../../core/memory-store'
import { currentWorkspace, payloadClient } from '../../lib/session'

export type MemoryResult = { error?: string }

const BAD_INPUT = 'Write 1 to 300 characters, pick where it applies and hand it to at least one stage.'

const addInput = z.object({ product: z.number().int().positive(), input: memoryInput })
const saveInput = z.object({ id: z.number().int().positive(), input: memoryInput })
const switchInput = z.object({ id: z.number().int().positive(), off: z.boolean() })
const idInput = z.object({ id: z.number().int().positive() })

const whoIs = async (): Promise<Who> => {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return notFound()
  return { person: { id: String(user.id), role: user.role, workspaceIds: [workspace.id] }, workspace: workspace.id }
}

const change = async <T>(schema: z.ZodType<T>, raw: unknown, work: (who: Who, given: T) => Promise<void>) => {
  const who = await whoIs()
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { error: BAD_INPUT }
  try {
    await work(who, parsed.data)
  } catch (error) {
    if (error instanceof MemoryNotFound) return notFound()
    if (!(error instanceof MemoryError)) throw error
    return { error: error.message }
  }
  revalidatePath('/memory', 'layout')
  return {}
}

export async function addMemoryAction(raw: unknown): Promise<MemoryResult> {
  return change(addInput, raw, async (who, given) => {
    await addMemory(await payloadClient(), who, given)
  })
}

export async function saveMemoryAction(raw: unknown): Promise<MemoryResult> {
  return change(saveInput, raw, async (who, given) => saveMemory(await payloadClient(), who, given))
}

export async function switchMemoryAction(raw: unknown): Promise<MemoryResult> {
  return change(switchInput, raw, async (who, given) => setMemoryOff(await payloadClient(), who, given))
}

export async function deleteMemoryAction(raw: unknown): Promise<MemoryResult> {
  return change(idInput, raw, async (who, given) => deleteMemory(await payloadClient(), who, given))
}
