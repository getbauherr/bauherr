export type SeenKey = { ticket: number; need: string; since: string }

export const seenKey = (k: SeenKey): string => `${k.ticket}|${k.need}|${k.since}`

export const unseenOf = <T extends { id: number; decision: { need: string; openSince: string } }>(seen: SeenKey[], items: T[]): Set<number> => {
  const known = new Set(seen.map(seenKey))
  return new Set(items.filter((i) => !known.has(seenKey({ ticket: i.id, need: i.decision.need, since: i.decision.openSince }))).map((i) => i.id))
}
