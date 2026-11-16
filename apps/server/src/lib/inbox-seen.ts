/** What a person has opened: the need on a Ticket and the time that decision opened (`Decision.openSince`). */
export type SeenKey = { ticket: number; need: string; since: string }

/** The key of one decision; a new need on the Ticket, or the same need opened again later, is another key. */
export const seenKey = (k: SeenKey): string => `${k.ticket}|${k.need}|${k.since}`

/** The decisions among `items` the person has not opened: no seen row matches the Ticket, need and decision time. */
export const unseenOf = <T extends { id: number; decision: { need: string; openSince: string } }>(seen: SeenKey[], items: T[]): Set<number> => {
  const known = new Set(seen.map(seenKey))
  return new Set(items.filter((i) => !known.has(seenKey({ ticket: i.id, need: i.decision.need, since: i.decision.openSince }))).map((i) => i.id))
}
