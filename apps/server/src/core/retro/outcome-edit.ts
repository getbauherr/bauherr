import type { Payload } from 'payload'
import { mayDecide } from '../decide'
import type { Who } from '../memory'
import { RetroInvalid, RetroNotFound, type Decision, type Outcome } from './schema'
import { loadRetro, saveOutcome } from './store'

const update = async (
  payload: Payload,
  who: Who,
  retroId: number,
  change: (outcome: Outcome) => Outcome,
): Promise<Outcome> => {
  if (!mayDecide(who.person, who.workspace)) throw new RetroInvalid('Only a Bauherr of this Workspace holds a Retro.')
  const retro = await loadRetro(payload, who.workspace, retroId)
  if (!retro?.outcome) throw new RetroNotFound('This Retro has no outcome yet.')
  if (retro.state === 'applied') throw new RetroInvalid('This Retro is already applied.')
  const next = change(retro.outcome)
  await saveOutcome(payload, retro.id, next, retro.state)
  return next
}

export const decideChange = (payload: Payload, who: Who, retro: number, id: string, decision: Decision) =>
  update(payload, who, retro, (outcome) => ({
    ...outcome,
    documents: outcome.documents.map((document) => ({
      ...document,
      changes: document.changes.map((change) => (change.id === id ? { ...change, decision } : change)),
    })),
  }))

export const editChange = (payload: Payload, who: Who, retro: number, id: string, add: string) => {
  if (add.trim() === '') throw new RetroInvalid('A change cannot be empty: discard it instead.')
  return update(payload, who, retro, (outcome) => ({
    ...outcome,
    documents: outcome.documents.map((document) => ({
      ...document,
      changes: document.changes.map((change) => (change.id === id ? { ...change, add: add.trim() } : change)),
    })),
  }))
}

export const decideTicket = (payload: Payload, who: Who, retro: number, id: string, decision: Decision) =>
  update(payload, who, retro, (outcome) => ({
    ...outcome,
    tickets: outcome.tickets.map((ticket) => (ticket.id === id ? { ...ticket, decision } : ticket)),
  }))
