import { liveTicket, ticketVersion } from '../../../../(app)/lib/ticket-live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `{ v }`: the newest `updated_at` (epoch ms) of this Ticket and its Runs, Steps, sessions, history events and human touches; the Ticket page refreshes only when it moves. Database only, one query. */
export const GET = async (_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const t = await liveTicket((await params).id)
  return t instanceof Response ? t : Response.json({ v: await ticketVersion(t.payload, t.id) })
}
