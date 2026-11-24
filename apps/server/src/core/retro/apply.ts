import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { mayDecide } from '../decide'
import type { ForgeWriter, ProductTarget } from '../forge/writer'
import { NotAllowedToChangeMemory, type Who } from '../memory'
import { readDocument, saveDocument } from '../memory-documents'
import { applyKept, undecidedCount } from './changes'
import { targetOf } from './outcome'
import { RetroInvalid, RetroNotFound, RetroUndecided, type Outcome, type OutcomeTicket } from './schema'
import { loadRetro, saveOutcome, type Retro } from './store'

export type ApplyDeps = { writer: ForgeWriter; factoryRepo: string }

const factoryTarget = async (payload: Payload, workspace: number, repo: string): Promise<ProductTarget> => {
  const found = await payload.db.drizzle.execute(sql`SELECT "product_id" FROM "ticket_sources"
    WHERE "workspace_id" = ${workspace} AND lower("repo") = ${repo.toLowerCase()} ORDER BY "id" LIMIT 1`)
  const row = found.rows[0]
  if (!row) throw new RetroInvalid(`Connect ${repo} as a Product first: factory tickets open there.`)
  return { workspace, product: z.coerce.number().parse(row.product_id) }
}

const keptOf = (outcome: Outcome) => outcome.documents.filter((d) => d.changes.some((c) => c.decision === 'keep'))

const checkPerson = (who: Who, outcome: Outcome): void => {
  if (!mayDecide(who.person, who.workspace)) throw new RetroInvalid('Only a Bauherr of this Workspace holds a Retro.')
  if (keptOf(outcome).some((document) => document.scope === 'factory') && who.person.role !== 'admin') {
    throw new NotAllowedToChangeMemory('Only an Admin applies a change to the Factory document.')
  }
}

const saveDocuments = async (payload: Payload, who: Who, retro: Retro, outcome: Outcome): Promise<Outcome> => {
  let current = outcome
  for (const document of keptOf(outcome)) {
    if (current.saved.includes(document.scope)) continue
    const target = targetOf(retro, document.scope)
    const body = applyKept(await readDocument(payload, target), document.changes)
    await saveDocument(payload, who, target, body, 'retro')
    current = { ...current, saved: [...current.saved, document.scope] }
    await saveOutcome(payload, retro.id, current, 'outcome')
  }
  return current
}

const openTicket = async (
  payload: Payload,
  deps: ApplyDeps,
  retro: Retro,
  ticket: OutcomeTicket,
): Promise<number> => {
  const target =
    ticket.repo === 'factory'
      ? await factoryTarget(payload, retro.workspace, deps.factoryRepo)
      : { workspace: retro.workspace, product: retro.product }
  const day = retro.at.toISOString().slice(0, 10)
  const issue = await deps.writer.openIssue(
    target,
    {
      title: ticket.title,
      body: `${ticket.body}\n\nFrom the Retro of ${day}.`,
      reference: `bauherr-retro-${retro.id}-${ticket.id}`,
    },
  )
  return issue.number
}

const openTickets = async (
  payload: Payload,
  deps: ApplyDeps,
  retro: Retro,
  outcome: Outcome,
): Promise<Outcome> => {
  let current = outcome
  for (const ticket of outcome.tickets) {
    if (ticket.decision !== 'keep' || ticket.number !== null) continue
    const number = await openTicket(payload, deps, retro, ticket)
    current = {
      ...current,
      tickets: current.tickets.map((other) => (other.id === ticket.id ? { ...other, number } : other)),
    }
    await saveOutcome(payload, retro.id, current, 'outcome')
  }
  return current
}

export const applyRetro = async (
  payload: Payload,
  deps: ApplyDeps,
  who: Who,
  retroId: number,
): Promise<Outcome> => {
  const retro = await loadRetro(payload, who.workspace, retroId)
  if (!retro?.outcome) throw new RetroNotFound('This Retro has no outcome yet.')
  if (retro.state === 'applied') return retro.outcome
  checkPerson(who, retro.outcome)
  if (undecidedCount(retro.outcome) > 0) throw new RetroUndecided('Keep or discard every change first.')
  const saved = await saveDocuments(payload, who, retro, retro.outcome)
  const done = await openTickets(payload, deps, retro, saved)
  await saveOutcome(payload, retro.id, done, 'applied')
  return done
}
