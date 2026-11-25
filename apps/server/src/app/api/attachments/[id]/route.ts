import { HTML_TYPE, MOCKUP_POLICY } from '../../../../core/attachments/image'
import { readImage, type StoredImage } from '../../../../core/views/attachments'
import { mayOpenRequest } from '../../../../core/views/request-access'
import { isBauherr, isProductOwner } from '../../../../lib/people'
import { getPerson, payloadClient, workspacesOf } from '../../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const notFound = (): Response => new Response(null, { status: 404 })

const mayRead = async (person: NonNullable<Awaited<ReturnType<typeof getPerson>>>, image: StoredImage) => {
  if (isProductOwner(person)) return mayOpenRequest(person, { workspace: image.workspace, product: image.product })
  return isBauherr(person) && (await workspacesOf(person)).some((workspace) => workspace.id === image.workspace)
}

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const person = await getPerson()
  const id = Number((await context.params).id)
  if (!person || !Number.isInteger(id) || id <= 0) return notFound()
  const image = await readImage(await payloadClient(), id)
  if (!image || !(await mayRead(person, image))) return notFound()
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      ...(image.contentType === HTML_TYPE ? { 'Content-Security-Policy': MOCKUP_POLICY } : {}),
    },
  })
}
