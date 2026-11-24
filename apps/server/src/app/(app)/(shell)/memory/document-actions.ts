'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { DOCUMENT_SCOPES, MemoryError, MemoryNotFound, type Who } from '../../../../core/memory'
import { saveDocument, type DocumentTarget } from '../../../../core/memory-documents'
import { currentWorkspace, payloadClient } from '../../lib/session'

export type DocumentChoice = { scope: (typeof DOCUMENT_SCOPES)[number]; product?: number }
export type DocumentResult = { error?: string }

const input = z.object({
  scope: z.enum(DOCUMENT_SCOPES),
  product: z.number().int().positive().optional(),
  body: z.string(),
})

const BAD_INPUT = 'Pick a document to save.'

export async function saveDocumentAction(raw: unknown): Promise<DocumentResult> {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return notFound()
  const parsed = input.safeParse(raw)
  if (!parsed.success) return { error: BAD_INPUT }
  const { scope, product, body } = parsed.data
  const who: Who = {
    person: { id: String(user.id), role: user.role, workspaceIds: [workspace.id] },
    workspace: workspace.id,
  }
  const target: DocumentTarget | null =
    scope === 'factory'
      ? { scope }
      : scope === 'workspace'
        ? { scope, workspace: workspace.id }
        : product === undefined
          ? null
          : { scope, workspace: workspace.id, product }
  if (!target) return { error: BAD_INPUT }
  try {
    await saveDocument(await payloadClient(), who, target, body)
  } catch (error) {
    if (error instanceof MemoryNotFound) return notFound()
    if (!(error instanceof MemoryError)) throw error
    return { error: error.message }
  }
  revalidatePath('/memory')
  return {}
}
