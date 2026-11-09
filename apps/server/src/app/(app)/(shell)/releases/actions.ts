'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { releaseDraft, releaseSummary, shipSelected } from '../../../../lib/ship-release'
import { isAdmin } from '../../lib/settings'
import { currentWorkspace, payloadClient } from '../../lib/session'

type Pick = { product: number; ids: number[] }

/** Version and notes for the Tickets ticked on the Releases page (no model call, no release list from the forge). */
export async function previewRelease({ product, ids }: Pick): Promise<{ version: string; notes: string } | { error: string }> {
  const { workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const payload = await payloadClient()
  try {
    if (!(await payload.find({ collection: 'products', where: { and: [{ id: { equals: product } }, { workspace: { equals: workspace.id } }] }, limit: 1, depth: 0, overrideAccess: true })).totalDocs) notFound()
    const { version, notes } = await releaseDraft(payload, product, ids, false)
    return { version, notes }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Admin only: the model-written summary for the ticked Tickets, when the Summarise button is clicked. */
export async function summariseRelease({ product, ids }: Pick): Promise<{ summary: string } | { error: string }> {
  const { user, workspace } = await currentWorkspace()
  if (!workspace || !isAdmin(user)) notFound()
  const payload = await payloadClient()
  try {
    if (!(await payload.find({ collection: 'products', where: { and: [{ id: { equals: product } }, { workspace: { equals: workspace.id } }] }, limit: 1, depth: 0, overrideAccess: true })).totalDocs) notFound()
    return { summary: await releaseSummary(payload, product, ids) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Admin only (`shipSelected` refuses anyone else). Returns the refusal as text so it shows on the page. */
export async function shipReleaseAction(a: Pick & { version: string; notes: string; summary: string }): Promise<{ tag: string; url: string } | { error: string }> {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) notFound()
  try {
    const res = await shipSelected(await payloadClient(), user, { workspaceId: workspace.id, ...a })
    revalidatePath('/releases')
    revalidatePath('/')
    return res
  } catch (e) {
    return { error: (e as Error).message }
  }
}
