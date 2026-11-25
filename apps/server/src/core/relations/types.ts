export type ForgeField = 'blockedBy' | 'parent'

export type RelationType = {
  key: string
  forward: string
  inverse: string
  directed: boolean
  blocksWork: boolean
  loopsAllowed: boolean
  singleParent: boolean
  forge?: { field: ForgeField; ticketIs: 'from' | 'to' }
}

export const RELATION_TYPES: readonly RelationType[] = [
  {
    key: 'blocks',
    forward: 'blocks',
    inverse: 'is blocked by',
    directed: true,
    blocksWork: true,
    loopsAllowed: false,
    singleParent: false,
    forge: { field: 'blockedBy', ticketIs: 'to' },
  },
  {
    key: 'part-of',
    forward: 'is part of',
    inverse: 'has part',
    directed: true,
    blocksWork: false,
    loopsAllowed: false,
    singleParent: true,
    forge: { field: 'parent', ticketIs: 'from' },
  },
  {
    key: 'relates-to',
    forward: 'relates to',
    inverse: 'relates to',
    directed: false,
    blocksWork: false,
    loopsAllowed: true,
    singleParent: false,
  },
]

export class RelationRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export const typeOf = (key: string, types: readonly RelationType[] = RELATION_TYPES): RelationType => {
  const found = types.find((type) => type.key === key)
  if (!found) {
    throw new RelationRefused(`Unknown relation type "${key}": use one of ${types.map((t) => t.key).join(', ')}.`)
  }
  return found
}
