import { markSeen } from '../../(app)/lib/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `{ key, seen }` marks or unmarks a decision as seen. A plain fetch, not a server action: an action in flight queues behind and can swallow a navigation the person starts meanwhile. */
export const POST = async (req: Request): Promise<Response> => {
  const body = (await req.json().catch(() => null)) as { key?: { ticket?: unknown; need?: unknown; since?: unknown }; seen?: unknown } | null
  const k = body?.key
  if (!k || typeof k.ticket !== 'number' || typeof k.need !== 'string' || typeof k.since !== 'string') return Response.json({ error: 'bad request' }, { status: 400 })
  try {
    await markSeen({ ticket: k.ticket, need: k.need, since: k.since }, body?.seen !== false)
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  return new Response(null, { status: 204 })
}
