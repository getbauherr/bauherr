import { notFound, redirect } from 'next/navigation'
import { currentWorkspace, payloadClient } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

/** `#123` in a chat answer: the Ticket with that number in the Workspace (the newest when several Products share it). */
export default async function TicketByNumber({ params }: { params: Promise<{ number: string }> }) {
  const { workspace } = await currentWorkspace()
  const number = Number((await params).number)
  if (!workspace || !Number.isInteger(number)) notFound()
  const { docs } = await (await payloadClient()).find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace.id } }, { number: { equals: number } }] }, sort: '-updatedAt', limit: 1, depth: 0, overrideAccess: true })
  if (!docs[0]) notFound()
  redirect(`/tickets/${docs[0].id}`)
}
