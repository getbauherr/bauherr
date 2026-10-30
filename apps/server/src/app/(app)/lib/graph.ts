export type GraphTicket = { id: number; number: number; run: { status: string } | null; stage: string; blockedBy: { id: number }[] }
export type GraphNode = { id: number; col: number; row: number; ready: boolean; critical: boolean; isolated: boolean }
export type GraphEdge = { from: number; to: number; critical: boolean }

const LEASED = ['running', 'awaiting_session']

/**
 * Left-to-right layout of open Tickets: column = length of the longest blocker chain leading to the Ticket,
 * row = rank by Ticket number inside the column among connected Tickets. Edges run blocker -> blocked.
 * The critical path is the longest chain (lowest numbers win ties). Back edges of a cycle are ignored and `cycle` is set.
 * Isolated Tickets (no edge between shown Tickets) get `isolated` and no row.
 */
export function layoutGraph(tickets: GraphTicket[]): { nodes: GraphNode[]; edges: GraphEdge[]; cycle: boolean } {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const blockers = new Map<number, number[]>()
  for (const t of tickets) blockers.set(t.id, t.blockedBy.map((b) => b.id).filter((b) => byId.has(b) && b !== t.id))
  const state = new Map<number, 1 | 2>()
  const back = new Set<string>()
  const visit = (id: number) => {
    state.set(id, 1)
    for (const b of blockers.get(id)!) {
      if (state.get(b) === 1) back.add(`${b}>${id}`)
      else if (!state.has(b)) visit(b)
    }
    state.set(id, 2)
  }
  for (const t of [...tickets].sort((a, b) => a.number - b.number)) if (!state.has(t.id)) visit(t.id)
  for (const [id, bs] of blockers) blockers.set(id, bs.filter((b) => !back.has(`${b}>${id}`)))

  const col = new Map<number, number>()
  const depth = (id: number): number => {
    if (!col.has(id)) col.set(id, Math.max(-1, ...blockers.get(id)!.map(depth)) + 1)
    return col.get(id)!
  }
  tickets.forEach((t) => depth(t.id))

  const linked = new Set([...blockers].flatMap(([id, bs]) => (bs.length ? [id, ...bs] : [])))
  const num = (id: number) => byId.get(id)!.number
  const end = [...linked].sort((a, b) => col.get(b)! - col.get(a)! || num(a) - num(b))[0]
  const critical = new Set<number>()
  for (let at: number | undefined = end; at !== undefined; ) {
    critical.add(at)
    const c: number = col.get(at)!
    at = c ? blockers.get(at)!.filter((b) => col.get(b) === c - 1).sort((x, y) => num(x) - num(y))[0] : undefined
  }

  const rows = new Map<number, number>()
  const nodes = [...tickets].sort((a, b) => a.number - b.number).map((t): GraphNode => {
    const isolated = !linked.has(t.id)
    const c = col.get(t.id)!
    const row = isolated ? 0 : (rows.set(c, (rows.get(c) ?? -1) + 1), rows.get(c)!)
    return { id: t.id, col: c, row, isolated, critical: critical.has(t.id), ready: t.blockedBy.length === 0 && t.stage !== 'done' && !LEASED.includes(t.run?.status ?? '') }
  })
  const edges = [...blockers].flatMap(([to, bs]) => bs.map((from) => ({ from, to, critical: critical.has(from) && critical.has(to) && col.get(to) === col.get(from)! + 1 })))
  return { nodes, edges, cycle: back.size > 0 }
}
