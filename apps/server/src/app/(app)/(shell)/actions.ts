'use server'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { moveInStage } from '../lib/reorder'
import { currentWorkspace, payloadClient } from '../lib/session'

const ids = z.object({ recordId: z.number().int().positive(), afterId: z.number().int().positive().nullable() })

export async function moveCard(recordId: number, afterId: number | null): Promise<{ moved: boolean }> {
  const { workspace } = await currentWorkspace()
  const input = ids.safeParse({ recordId, afterId })
  if (!workspace || !input.success) return notFound()
  return { moved: await moveInStage(await payloadClient(), { workspace: workspace.id, ...input.data }) }
}
