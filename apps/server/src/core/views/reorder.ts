export type Ranked = { id: number; rank: number }

const between = (above: number | undefined, below: number | undefined): number | null => {
  if (above === undefined) return below === undefined ? 0 : below - 1
  if (below === undefined) return above + 1
  const middle = (above + below) / 2
  return middle > above && middle < below ? middle : null
}

const renumber = (order: Ranked[], base: number): Ranked[] =>
  order
    .map((card, index) => ({ id: card.id, rank: base + index }))
    .filter((card, index) => card.rank !== order[index]?.rank)

export const rankChanges = (stage: Ranked[], id: number, afterId: number | null): Ranked[] | null => {
  const moving = stage.find((card) => card.id === id)
  const others = stage.filter((card) => card.id !== id)
  const after = afterId === null ? -1 : others.findIndex((card) => card.id === afterId)
  if (!moving || (afterId !== null && after < 0)) return null
  const at = after + 1
  const order = [...others.slice(0, at), moving, ...others.slice(at)]
  if (order.every((card, index) => card.id === stage[index]?.id)) return []
  const rank = between(others[at - 1]?.rank, others[at]?.rank)
  if (rank !== null) return [{ id, rank }]
  return renumber(order, Math.min(...stage.map((card) => card.rank)))
}
