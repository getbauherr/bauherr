import { readImage } from '../../../../core/views/attachments'
import { isBauherr, isProductOwner } from '../../../../lib/people'
import { getPerson, payloadClient, workspacesOf } from '../../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const notFound = (): Response => new Response(null, { status: 404 })

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const person = await getPerson()
  const id = Number((await context.params).id)
  if (!person || isProductOwner(person) || !isBauherr(person) || !Number.isInteger(id) || id <= 0) return notFound()
  const image = await readImage(await payloadClient(), id)
  if (!image || !(await workspacesOf(person)).some((workspace) => workspace.id === image.workspace)) return notFound()
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
