import type { Payload } from 'payload'
import { checkRelation, normalised, type Edge } from './rules'
import { deleteEdge, insertEdge, itemFacts, loadEdges } from './store'
import { RELATION_TYPES, RelationRefused, typeOf, type RelationType } from './types'

export const checkNewRelation = async (
  payload: Payload,
  workspace: number,
  input: Edge,
  types: readonly RelationType[] = RELATION_TYPES,
): Promise<{ edge: Edge; present: boolean }> => {
  const type = typeOf(input.type, types)
  const edge = normalised(input, type)
  const existing = await loadEdges(payload, workspace, type.key)
  const facts = await itemFacts(payload, [...new Set([edge.from, edge.to, ...existing.flatMap((e) => [e.from, e.to])])])
  for (const id of [edge.from, edge.to]) {
    if (facts.get(id)?.workspace !== workspace) throw new RelationRefused(`Ticket ${id} is not in this Workspace.`)
  }
  const label = (id: number) => `#${facts.get(id)?.number ?? id}`
  const state = checkRelation(edge, type, existing, label)
  return { edge, present: state === 'present' }
}

export const addRelation = async (
  payload: Payload,
  workspace: number,
  input: Edge,
  types: readonly RelationType[] = RELATION_TYPES,
): Promise<Edge> => {
  const { edge } = await checkNewRelation(payload, workspace, input, types)
  await insertEdge(payload, workspace, edge)
  return edge
}

export const removeRelation = async (
  payload: Payload,
  input: Edge,
  types: readonly RelationType[] = RELATION_TYPES,
): Promise<Edge> => {
  const edge = normalised(input, typeOf(input.type, types))
  await deleteEdge(payload, edge)
  return edge
}
