import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StatusChip } from '../../../components/StatusChip'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, limit: 1, overrideAccess: true } as const
  const inWorkspace = (key: string, value: string | number) => ({ and: [{ [key]: { equals: value } }, { workspace: { equals: workspace.id } }] })
  const [run] = (await payload.find({ collection: 'runs', where: inWorkspace('id', id), ...q })).docs as unknown as { id: number; ticket: number; stage: string; status: string }[]
  if (!run) notFound()
  const [ticket] = (await payload.find({ collection: 'tickets', where: inWorkspace('id', run.ticket), ...q })).docs as unknown as { id: number; number: number; title: string }[]
  return (
    <>
      <h1 className="title">Run #{run.id}</h1>
      <p className="body">{run.stage} <StatusChip status={run.status} /></p>
      {ticket && <p><Link className="link" href={`/tickets/${ticket.id}`}>#{ticket.number} {ticket.title}</Link></p>}
      <p className="muted">Details arrive with the next slice.</p>
    </>
  )
}
