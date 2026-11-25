import { RelationRefused, type RelationType } from './types'

export type Edge = { from: number; to: number; type: string }
export type Labeller = (item: number) => string

export const normalised = (edge: Edge, type: RelationType): Edge =>
  !type.directed && edge.from > edge.to ? { ...edge, from: edge.to, to: edge.from } : edge

const pathBetween = (edges: Edge[], start: number, goal: number): number[] | null => {
  const seen = new Set([start])
  const queue: number[][] = [[start]]
  for (const path of queue) {
    const last = path[path.length - 1]
    if (last === goal) return path
    for (const edge of edges) {
      if (edge.from !== last || seen.has(edge.to)) continue
      seen.add(edge.to)
      queue.push([...path, edge.to])
    }
  }
  return null
}

export const checkRelation = (
  edge: Edge,
  type: RelationType,
  existing: Edge[],
  label: Labeller,
): 'new' | 'present' => {
  if (edge.from === edge.to) throw new RelationRefused(`${label(edge.from)} cannot ${type.forward} itself.`)
  const same = existing.filter((e) => e.type === type.key)
  if (same.some((e) => e.from === edge.from && e.to === edge.to)) return 'present'
  const parent = type.singleParent ? same.find((e) => e.from === edge.from) : undefined
  if (parent) {
    throw new RelationRefused(
      `${label(edge.from)} already ${type.forward} ${label(parent.to)}: remove that first, a ticket has one parent.`,
    )
  }
  const loop = type.loopsAllowed ? null : pathBetween(same, edge.to, edge.from)
  if (loop) {
    const named = [edge.from, ...loop].map(label)
    throw new RelationRefused(
      `That would close a loop of "${type.forward}": ${named.join(` ${type.forward} `)}.`,
    )
  }
  return 'new'
}
