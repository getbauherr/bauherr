import type { Payload } from 'payload'
import { connectionInput } from '../../lib/connection'
import { mayDecide } from '../decide'
import { readerFor } from '../forge/reader'
import { loadProductRow } from '../forge/write-store'
import type { FigureFilter } from '../insights/figures'
import { resolveRange, type Range, type RangeInput } from '../insights/range'
import type { Who } from '../memory'
import { readDocument } from '../memory-documents'
import type { RetroModel } from './model'
import { instructionFiles, ticketNotes } from './history'
import { buildOpening } from './opening'
import { parseReply, RETRY_LINE, turnsOf, type RetroContext } from './prompt'
import { RetroInvalid, RetroNotFound, type Proposal, type Reply } from './schema'
import { addMessage, createRetro, loadRetro, messagesOf, saveAgreed, type Message, type Retro } from './store'

export type ConverseDeps = { model: RetroModel; skill: () => Promise<string>; now: () => Date }
export type StartInput = { product: number; range: RangeInput; label: string }

const guard = (who: Who): void => {
  if (!mayDecide(who.person, who.workspace)) throw new RetroInvalid('Only a Bauherr of this Workspace holds a Retro.')
}

const noTags = { listTags: () => Promise.reject(new RetroInvalid('This range needs a release.')) }

const rangeOf = async (payload: Payload, who: Who, input: StartInput, now: Date): Promise<Range> => {
  const byRelease = 'tag' in input.range || 'lastRelease' in input.range
  const row = byRelease ? await loadProductRow(payload, { workspace: who.workspace, product: input.product }) : null
  if (!row) return resolveRange(input.range, { now, repo: '', forge: { ...noTags, releaseByTag: noTags.listTags } })
  const forge = readerFor(await connectionInput(payload, row.connection)).forge
  return resolveRange(input.range, { now, repo: row.repo, forge })
}

const contextOf = async (payload: Payload, retro: Pick<Retro, 'workspace' | 'product' | 'label' | 'opening'>) => {
  const where = { workspace: retro.workspace, product: retro.product }
  const recordIds = retro.opening?.tickets.map((ticket) => ticket.recordId) ?? []
  const context: RetroContext = {
    label: retro.label,
    opening: retro.opening as NonNullable<Retro['opening']>,
    notes: await ticketNotes(payload, recordIds),
    documents: {
      factory: await readDocument(payload, { scope: 'factory' }),
      workspace: await readDocument(payload, { scope: 'workspace', workspace: retro.workspace }),
      product: await readDocument(payload, { scope: 'product', ...where }),
    },
    files: await instructionFiles(payload, where),
  }
  return context
}

const ask = async (
  deps: ConverseDeps,
  workspace: number,
  context: RetroContext,
  messages: Message[],
): Promise<Reply> => {
  const system = await deps.skill()
  const turns = turnsOf(context, messages)
  const raw = await deps.model(workspace, system, turns)
  try {
    return parseReply(raw)
  } catch (error) {
    if (!(error instanceof RetroInvalid)) throw error
    const again = await deps.model(workspace, system, [
      ...turns,
      { role: 'assistant', content: raw },
      { role: 'user', content: RETRY_LINE },
    ])
    return parseReply(again)
  }
}

export const startRetro = async (
  payload: Payload,
  deps: ConverseDeps,
  who: Who,
  input: StartInput,
): Promise<number> => {
  guard(who)
  const range = await rangeOf(payload, who, input, deps.now())
  const filter: FigureFilter & { product: number } = { workspace: who.workspace, product: input.product, range }
  const opening = await buildOpening(payload, filter)
  const base = {
    workspace: who.workspace,
    product: input.product,
    from: range.from,
    to: range.to,
    label: input.label,
    createdBy: who.person.id,
    opening,
  }
  const reply = await ask(deps, who.workspace, await contextOf(payload, base), [])
  const id = await createRetro(payload, base)
  const retro = await loadRetro(payload, who.workspace, id)
  if (!retro) throw new RetroNotFound('The Retro vanished.')
  await addMessage(payload, retro, {
    role: 'assistant',
    body: reply.message,
    parts: { proposals: reply.proposals, raw: JSON.stringify(reply) },
  })
  return id
}

export const proposalsOf = (messages: Message[]): Map<string, Proposal> => {
  const latest = new Map<string, Proposal>()
  for (const message of messages) {
    for (const proposal of message.parts?.proposals ?? []) latest.set(proposal.id, proposal)
  }
  return latest
}

const open = async (payload: Payload, who: Who, retroId: number): Promise<Retro> => {
  guard(who)
  const retro = await loadRetro(payload, who.workspace, retroId)
  if (!retro) throw new RetroNotFound('This Retro does not exist.')
  return retro
}

const withAgreed = async (payload: Payload, retro: Retro, ids: string[]): Promise<void> => {
  const agreed = [...new Set([...retro.agreed, ...ids])]
  if (agreed.length !== retro.agreed.length) await saveAgreed(payload, retro.id, agreed)
}

export const sendMessage = async (
  payload: Payload,
  deps: ConverseDeps,
  who: Who,
  retroId: number,
  text: string,
): Promise<void> => {
  const retro = await open(payload, who, retroId)
  const body = text.trim()
  if (body === '') throw new RetroInvalid('Write an answer first.')
  await addMessage(payload, retro, { role: 'owner', body })
  const messages = await messagesOf(payload, retro.id)
  const reply = await ask(deps, who.workspace, await contextOf(payload, retro), messages)
  await addMessage(payload, retro, {
    role: 'assistant',
    body: reply.message,
    parts: { proposals: reply.proposals, raw: JSON.stringify(reply) },
  })
  const known = proposalsOf(await messagesOf(payload, retro.id))
  await withAgreed(payload, retro, reply.agreed.filter((id) => known.has(id)))
}

export const acceptProposal = async (payload: Payload, who: Who, retroId: number, id: string): Promise<void> => {
  const retro = await open(payload, who, retroId)
  if (!proposalsOf(await messagesOf(payload, retro.id)).has(id)) throw new RetroInvalid('This proposal does not exist.')
  await withAgreed(payload, retro, [id])
}
