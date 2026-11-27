'use server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { UploadRefused } from '../../../../core/attachments/image'
import { MESSAGE_FILES_MAX, MESSAGE_TEXT_MAX } from '../../../../core/conversations/limits'
import { CommentRefused, requestConversation } from '../../../../core/requests/comments'
import { commentOnRequest } from '../../../../core/requests/issue-comment'
import { mayOpenRequest, requestScope } from '../../../../core/views/request-access'
import { engineDeps } from '../../../../jobs/engine-deps'
import { publicUrl } from '../../../../lib/oidc'
import { secret } from '../../../../lib/secrets'
import { isProductOwner } from '../../../../lib/people'
import { personOf } from '../../../../lib/person'
import { REQUEST_PRODUCT_COOKIE, readableProducts } from '../../lib/requests'
import { payloadClient, requirePerson } from '../../lib/session'

const input = z.object({
  recordId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  text: z.string().max(MESSAGE_TEXT_MAX),
  fileIds: z.array(z.number().int().positive()).max(MESSAGE_FILES_MAX),
})

const allowed = async (recordId: number) => {
  const person = await requirePerson()
  const payload = await payloadClient()
  const scope = await requestScope(payload, recordId)
  if (scope === null || !mayOpenRequest(person, scope)) return notFound()
  return { person, payload, workspace: scope.workspace }
}

export async function startRequestConversation(recordId: number): Promise<number> {
  const { payload, workspace } = await allowed(z.number().int().positive().parse(recordId))
  return requestConversation(payload, workspace, recordId)
}

export type CommentResult = { error?: string }

export async function commentOnRequestAction(raw: unknown): Promise<CommentResult> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) return { error: 'Write a comment or attach a file.' }
  const { person, payload, workspace } = await allowed(parsed.data.recordId)
  const comment = {
    ...parsed.data,
    workspace,
    author: personOf(person),
    role: isProductOwner(person) ? ('product-owner' as const) : ('bauherr' as const),
    actorId: String(person.id),
  }
  try {
    const deps = { payload, forge: engineDeps(payload).forge, origin: publicUrl(), key: secret('PAYLOAD_SECRET') }
    await commentOnRequest(deps, comment)
  } catch (error) {
    if (error instanceof UploadRefused || error instanceof CommentRefused) return { error: error.message }
    throw error
  }
  revalidatePath(`/requests/${comment.recordId}`)
  revalidatePath(`/tickets/${comment.recordId}`)
  return {}
}

export async function chooseRequestProduct(product: number): Promise<void> {
  const id = z.number().int().positive().parse(product)
  const person = await requirePerson()
  const readable = await readableProducts(await payloadClient(), person)
  if (!readable.some((p) => p.id === id)) return notFound()
  ;(await cookies()).set(REQUEST_PRODUCT_COOKIE, String(id), { path: '/', sameSite: 'lax', maxAge: 31536000 })
  redirect(`/requests?product=${id}`)
}
