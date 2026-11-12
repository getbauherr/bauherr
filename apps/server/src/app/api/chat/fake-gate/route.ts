import { releaseFakeGate } from '../../../../lib/chat/fake'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** E2E only (`CHAT_FAKE=1`): lets the fake model's held refine turn go on. */
export const POST = (): Response => {
  if (process.env.CHAT_FAKE !== '1') return new Response(null, { status: 404 })
  releaseFakeGate()
  return new Response(null, { status: 204 })
}
