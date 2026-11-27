import { z } from 'zod'
import { UploadRefused } from '../../../../core/attachments/image'
import { listMessages } from '../../../../core/conversations/store'
import { TYPES } from '../../../../core/record/schema'
import type { CommentRole } from '../../../../core/requests/comments'
import { chooseType, closeRequest, joinExisting } from '../../../../core/requests/actions'
import { sendRequest } from '../../../../core/requests/send'
import { takeTurn } from '../../../../core/requests/turn'
import { draftView } from '../../../../core/requests/view'
import { isProductOwner } from '../../../../lib/people'
import { grantRequest } from '../../../(app)/lib/conversation-access'
import { refusal, sendDeps, turnDeps } from '../../../(app)/lib/request-wiring'
import { getPerson } from '../../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const action = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('message'),
    text: z.string(),
    fileIds: z.array(z.number().int().positive()).default([]),
  }),
  z.object({ action: z.literal('type'), type: z.enum(TYPES) }),
  z.object({ action: z.literal('send') }),
  z.object({ action: z.literal('join') }),
  z.object({ action: z.literal('close') }),
])

const state = async (payload: Parameters<typeof listMessages>[0], id: number) => ({
  messages: await listMessages(payload, id),
  draft: await draftView(payload, id),
})

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const granted = await grantRequest((await context.params).id)
  if (granted instanceof Response) return granted
  const current = await state(granted.payload, granted.id)
  return current.draft ? Response.json(current) : new Response(null, { status: 404 })
}

type Body = z.infer<typeof action>
type Granted = Exclude<Awaited<ReturnType<typeof grantRequest>>, Response>

const roleOf = async (): Promise<CommentRole> => {
  const person = await getPerson()
  return person && isProductOwner(person) ? 'product-owner' : 'bauherr'
}

const perform = async ({ payload, id }: Granted, body: Body): Promise<void> => {
  switch (body.action) {
    case 'message':
      return takeTurn(payload, await turnDeps(payload), { conversationId: id, text: body.text, fileIds: body.fileIds })
    case 'type':
      return chooseType(payload, id, body.type)
    case 'join':
      return joinExisting(payload, sendDeps(payload), id, await roleOf())
    case 'close':
      return closeRequest(payload, id)
    case 'send': {
      const reporter = (await getPerson())?.email ?? ''
      await sendRequest(payload, sendDeps(payload), { conversationId: id, reporter, role: await roleOf() })
    }
  }
}

export const POST = async (req: Request, context: Context): Promise<Response> => {
  const granted = await grantRequest((await context.params).id)
  if (granted instanceof Response) return granted
  const parsed = action.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Send an action.' }, { status: 400 })
  try {
    await perform(granted, parsed.data)
  } catch (error) {
    if (error instanceof UploadRefused) return Response.json({ error: error.message }, { status: error.status })
    return refusal(error)
  }
  return Response.json(await state(granted.payload, granted.id))
}
