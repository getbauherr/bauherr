import { fakeRequests } from '../../../../lib/chat/fake'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** E2E only (`CHAT_FAKE=1`): the requests the fake model got, oldest first. */
export const GET = (): Response => {
  if (process.env.CHAT_FAKE !== '1') return new Response(null, { status: 404 })
  return Response.json(fakeRequests())
}
