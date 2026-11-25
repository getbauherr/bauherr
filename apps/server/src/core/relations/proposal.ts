import type { RelationKind } from '../record/schema'
import type { Edge } from './rules'

export const edgeOf = (kind: RelationKind, self: number, other: number): Edge =>
  kind === 'blocked-by' ? { from: other, to: self, type: 'blocks' } : { from: self, to: other, type: 'part-of' }
