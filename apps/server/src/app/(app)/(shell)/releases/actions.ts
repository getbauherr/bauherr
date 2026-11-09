'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { releaseDraft, shipSelected } from '../../../../lib/ship-release'
import { currentWorkspace, payloadClient } from '../../lib/session'

type Pick = { product: number; ids: number[] }

/** Version, notes and summary for the Tickets ticked on the Releases page. */
export async function previewRelease({ product, ids }: Pick): Promise<{ version: string; notes: string; summary: string } | { error: string }> {
  const { workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const payload = await payloadClient()
  try {
    if (!(await payload.find({ collection: 'products', where: { and: [{ id: { equals: product } }, { workspace: { equals: workspace.id } }] }, limit: 1, depth: 0, overrideAccess: true })).totalDocs) notFound()
    const { version, notes, summary } = await releaseDraft(payload, product, ids)
    return { version, notes, summary }
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
