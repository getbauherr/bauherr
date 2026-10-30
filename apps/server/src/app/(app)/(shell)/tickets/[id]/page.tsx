import { notFound } from 'next/navigation'
import { StatusChip } from '../../../components/StatusChip'
import { stageOf } from '../../../lib/needs-you'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'

export const dynamic = 'force-dynamic'

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, limit: 1, overrideAccess: true } as const
  const [ticket] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspace.id } }] }, ...q })).docs as unknown as Record<string, any>[]
  if (!ticket) notFound()
  const [run] = (await payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, sort: '-createdAt', ...q })).docs as unknown as { status: string }[]
  return (
    <>
      <h1 className="title">#{ticket.number} {ticket.title}</h1>
      <p className="body"><span className="label muted">{stageOf(ticket)}</span> {run && <StatusChip status={run.status} />}</p>
      {isWebUrl(ticket.url) && <p><a className="link" href={ticket.url}>Open on the forge</a></p>}
      <p className="muted">Details arrive with the next slice.</p>
    </>
  )
}
