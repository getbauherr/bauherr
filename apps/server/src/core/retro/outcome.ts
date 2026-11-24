import type { Payload } from 'payload'
import { mayDecide } from '../decide'
import type { Who } from '../memory'
import { DOCUMENT_SCOPES } from '../memory'
import { readDocument, type DocumentTarget } from '../memory-documents'
import { proposalsOf } from './converse'
import {
  RetroInvalid,
  RetroNotFound,
  type Outcome,
  type OutcomeDocument,
  type Proposal,
} from './schema'
import { loadRetro, messagesOf, saveOutcome, type Retro } from './store'

type Scope = (typeof DOCUMENT_SCOPES)[number]

export const targetOf = (retro: Pick<Retro, 'workspace' | 'product'>, scope: Scope): DocumentTarget =>
  scope === 'factory'
    ? { scope }
    : scope === 'workspace'
      ? { scope, workspace: retro.workspace }
      : { scope, workspace: retro.workspace, product: retro.product }

const previous = (outcome: Outcome | null, id: string) =>
  [...(outcome?.documents.flatMap((document) => document.changes) ?? [])].find((change) => change.id === id)

const documentOf = async (
  payload: Payload,
  retro: Retro,
  scope: Scope,
  agreed: Proposal[],
): Promise<OutcomeDocument> => ({
  scope,
  base: await readDocument(payload, targetOf(retro, scope)),
  changes: agreed
    .filter((proposal) => proposal.level === scope && proposal.change)
    .map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      section: proposal.change?.section ?? 'All stages',
      remove: proposal.change?.remove ?? null,
      add: proposal.change?.add ?? '',
      decision: 'undecided',
      ...(previous(retro.outcome, proposal.id) ?? {}),
    })),
})

export const buildOutcome = async (payload: Payload, who: Who, retroId: number): Promise<Outcome> => {
  if (!mayDecide(who.person, who.workspace)) throw new RetroInvalid('Only a Bauherr of this Workspace holds a Retro.')
  const retro = await loadRetro(payload, who.workspace, retroId)
  if (!retro) throw new RetroNotFound('This Retro does not exist.')
  if (retro.state === 'applied') throw new RetroInvalid('This Retro is already applied.')
  const known = proposalsOf(await messagesOf(payload, retro.id))
  const agreed = retro.agreed.flatMap((id) => known.get(id) ?? [])
  const earlier = new Map((retro.outcome?.tickets ?? []).map((ticket) => [ticket.id, ticket]))
  const outcome: Outcome = {
    documents: await Promise.all(DOCUMENT_SCOPES.map((scope) => documentOf(payload, retro, scope, agreed))),
    tickets: agreed.flatMap((proposal) =>
      proposal.ticket
        ? [
            {
              ...proposal.ticket,
              id: proposal.id,
              decision: earlier.get(proposal.id)?.decision ?? 'undecided',
              number: earlier.get(proposal.id)?.number ?? null,
            },
          ]
        : [],
    ),
    saved: retro.outcome?.saved ?? [],
  }
  await saveOutcome(payload, retro.id, outcome, 'outcome')
  return outcome
}
