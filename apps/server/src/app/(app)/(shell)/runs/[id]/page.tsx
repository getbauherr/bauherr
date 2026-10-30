import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatusChip } from '../../../components/StatusChip'
import { loadOverview } from '../../../lib/overview'
import { currentWorkspace } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspace } = await currentWorkspace()
  const data = workspace && (await loadOverview(workspace.id))
  const run = data && data.runs.find((r) => String(r.id) === id)
  if (!run) notFound()
  const ticket = data.tickets.find((t) => t.id === run.ticket)
  return (
    <>
      <h1 className="title">Run #{run.id}</h1>
      <p className="body">{run.stage} <StatusChip status={run.status} /></p>
      {ticket && <p><Link className="link" href={`/tickets/${ticket.id}`}>#{ticket.number} {ticket.title}</Link></p>}
      <p className="muted">Details arrive with the next slice.</p>
    </>
  )
}
