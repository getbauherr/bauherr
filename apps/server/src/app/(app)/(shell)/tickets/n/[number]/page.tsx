import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { currentWorkspace, payloadClient } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

/** `#123` in a chat answer: the Ticket with that number in the Workspace; when several Products share the number, the person picks. */
export default async function TicketByNumber({ params }: { params: Promise<{ number: string }> }) {
  const { workspace } = await currentWorkspace()
  const number = Number((await params).number)
  if (!workspace || !Number.isInteger(number)) notFound()
  const { docs } = await (await payloadClient()).find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace.id } }, { number: { equals: number } }] }, sort: 'product', limit: 20, depth: 1, select: { title: true, product: true }, overrideAccess: true })
  if (!docs.length) notFound()
  if (docs.length === 1) redirect(`/tickets/${docs[0]!.id}`)
  return (
    <>
      <h2 className="heading">#{number} exists in {docs.length} Products</h2>
      <ul className="flex flex-col gap-2" data-testid="ticket-chooser">
        {docs.map((t) => (
          <li key={t.id}>
            <Link href={`/tickets/${t.id}`} className="flex flex-col rounded-md border border-border bg-card px-4 py-3 hover:bg-secondary">
              <span className="small text-muted-foreground">{typeof t.product === 'object' && t.product ? (t.product as { name?: string }).name : ''}</span>
              <span>{String(t.title)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
