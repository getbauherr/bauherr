'use server'
import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { mayDecide } from '../../../../core/decide'
import { WriteError } from '../../../../core/forge/errors'
import { createWriter } from '../../../../core/forge/writer'
import type { Edge } from '../../../../core/relations/rules'
import { RelationRefused, typeOf } from '../../../../core/relations/types'
import {
  itemOfRecord,
  recordOfItem,
  RELATION_GROUPS,
  searchTickets,
  type Candidate,
  type RelationGroup,
} from '../../../../core/views/ticket-relations'
import { currentWorkspace, payloadClient } from '../../lib/session'

const input = z.object({
  recordId: z.number().int().positive(),
  group: z.enum(RELATION_GROUPS),
  other: z.number().int().positive(),
})

export type RelationResult = { error?: string }

const TYPES = { 'part-of': 'part-of', blocks: 'blocks', 'relates-to': 'relates-to' } as const
const NOT_ON_BOARD = 'That ticket is not on the board, so the link cannot be written to the forge.'

const edgeOf = (group: RelationGroup, mine: number, other: number): Edge =>
  group === 'blocked-by' ? { from: other, to: mine, type: 'blocks' } : { from: mine, to: other, type: TYPES[group] }

const keeperOf = (edge: Edge, mine: number): number => {
  const forge = typeOf(edge.type).forge
  return forge ? (forge.ticketIs === 'to' ? edge.to : edge.from) : mine
}

const change = (kind: 'addRelation' | 'removeRelation') => async (raw: unknown): Promise<RelationResult> => {
  const { user, workspace } = await currentWorkspace()
  const parsed = input.safeParse(raw)
  if (!workspace || !parsed.success) return notFound()
  if (!mayDecide({ id: String(user.id), role: user.role, workspaceIds: [workspace.id] }, workspace.id)) {
    return notFound()
  }
  const { recordId, group, other } = parsed.data
  const payload = await payloadClient()
  const mine = await itemOfRecord(payload, workspace.id, recordId)
  if (mine === null) return notFound()
  const edge = edgeOf(group, mine, other)
  const keeper = keeperOf(edge, mine)
  const keeperRecord = keeper === mine ? recordId : await recordOfItem(payload, keeper)
  if (keeperRecord === null) return { error: NOT_ON_BOARD }
  try {
    await createWriter(payload)[kind](keeperRecord, edge)
  } catch (error) {
    if (error instanceof RelationRefused || error instanceof WriteError) return { error: error.message }
    throw error
  }
  revalidatePath(`/tickets/${recordId}`)
  return {}
}

export async function addTicketRelation(raw: unknown): Promise<RelationResult> {
  return change('addRelation')(raw)
}

export async function removeTicketRelation(raw: unknown): Promise<RelationResult> {
  return change('removeRelation')(raw)
}

const searchInput = z.object({ recordId: z.number().int().positive(), query: z.string().max(200) })

export async function searchRelationCandidates(raw: unknown): Promise<Candidate[]> {
  const { user, workspace } = await currentWorkspace()
  const parsed = searchInput.safeParse(raw)
  if (!workspace || !parsed.success) return notFound()
  if (!mayDecide({ id: String(user.id), role: user.role, workspaceIds: [workspace.id] }, workspace.id)) {
    return notFound()
  }
  return searchTickets(await payloadClient(), workspace.id, parsed.data.recordId, parsed.data.query)
}
