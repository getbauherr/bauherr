import { notFound } from 'next/navigation'
import { loadOverview } from '../../../lib/overview'
import { currentWorkspace } from '../../../lib/session'
import { StatusChip } from '../../../components/StatusChip'

export const dynamic = 'force-dynamic'

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspace } = await currentWorkspace()
  const ticket = workspace && (await loadOverview(workspace.id)).tickets.find((t) => String(t.id) === id)
  if (!ticket) notFound()
  return (
    <>
      <h1 className="title">#{ticket.number} {ticket.title}</h1>
      <p className="body"><span className="chip label queued">{ticket.stage}</span> {ticket.run && <StatusChip status={ticket.run.status} />}</p>
      {/^https?:\/\//.test(ticket.url ?? '') && <p><a className="link" href={ticket.url!}>Open on the forge</a></p>}
      <p className="muted">Details arrive with the next slice.</p>
    </>
  )
}
