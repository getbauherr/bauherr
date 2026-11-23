import { cache } from 'react'
import { loadTicketRefs, type TicketRefs } from '../../../core/views/refs'
import { currentWorkspace, payloadClient } from './session'

export const ticketRefs = cache(async (): Promise<TicketRefs> => {
  const { workspace } = await currentWorkspace()
  if (!workspace) return { byId: new Map(), byMention: new Map() }
  return loadTicketRefs(await payloadClient(), workspace.id)
})
