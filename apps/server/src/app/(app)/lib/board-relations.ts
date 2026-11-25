import { z } from 'zod'
import type { Board, BoardCard } from '../../../core/views/board'

export const RELATION_FILTERS = ['blocking', 'blocked'] as const
export type RelationFilter = (typeof RELATION_FILTERS)[number]

export const RELATION_LABELS: Record<RelationFilter, string> = { blocking: 'Blocking others', blocked: 'Blocked' }

export type BoardView = { relation?: RelationFilter | undefined; group: boolean }

const search = z.object({
  relation: z.enum(RELATION_FILTERS).optional().catch(undefined),
  group: z.enum(['parent']).optional().catch(undefined),
})

export const parseView = (raw: { relation?: string; group?: string }): BoardView => {
  const parsed = search.parse(raw)
  return { relation: parsed.relation, group: parsed.group === 'parent' }
}

type Related = Pick<BoardCard, 'relations'>

export const isBlocking = (card: Related): boolean => (card.relations?.blocks.length ?? 0) > 0
export const isBlocked = (card: Related): boolean => (card.relations?.blockedBy.length ?? 0) > 0

const MATCHES: Record<RelationFilter, (card: Related) => boolean> = { blocking: isBlocking, blocked: isBlocked }

export const blockingFirst = <T extends Related>(cards: T[]): T[] =>
  [...cards].sort((a, b) => Number(isBlocking(b)) - Number(isBlocking(a)))

export const forView = <T extends Related>(cards: T[], relation: RelationFilter | undefined): T[] =>
  blockingFirst(relation === undefined ? cards : cards.filter(MATCHES[relation]))

export const countRelations = (lanes: Board): Record<RelationFilter, number> => {
  const open = [...Object.values(lanes.stages).flat(), ...lanes.parked].filter((card) => card.stage !== 'done')
  return { blocking: open.filter(isBlocking).length, blocked: open.filter(isBlocked).length }
}

export type Roles = { blockers: number[]; blocked: number[]; part: number[] }

const ids = (list: { recordId: number | null }[]): number[] => list.flatMap((entry) => entry.recordId ?? [])

export const rolesOf = (lanes: Board): Record<number, Roles> =>
  Object.fromEntries(
    [...Object.values(lanes.stages).flat(), ...lanes.parked].flatMap((card) => {
      const relations = card.relations
      if (relations === null) return []
      const part = [...(relations.parent ? [relations.parent] : []), ...(relations.parts?.tickets ?? [])]
      return [[card.recordId, { blockers: ids(relations.blockedBy), blocked: ids(relations.blocks), part: ids(part) }]]
    }),
  )

type Parent = NonNullable<BoardCard['relations']>['parent']
export type ParentGroup<T> = { key: string; parent: Parent; cards: T[] }

export const groupsByParent = <T extends { relations: BoardCard['relations'] }>(cards: T[]): ParentGroup<T>[] => {
  const groups = new Map<number, ParentGroup<T>>()
  const orphans: T[] = []
  for (const card of cards) {
    const parent = card.relations?.parent ?? null
    if (parent === null) {
      orphans.push(card)
      continue
    }
    const known = groups.get(parent.number)
    if (known) known.cards.push(card)
    else groups.set(parent.number, { key: `parent-${parent.number}`, parent, cards: [card] })
  }
  const bands = [...groups.values()].sort((a, b) => (a.parent?.number ?? 0) - (b.parent?.number ?? 0))
  return orphans.length ? [...bands, { key: 'no-parent', parent: null, cards: orphans }] : bands
}
