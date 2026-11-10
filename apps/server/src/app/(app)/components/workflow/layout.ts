import type { Graph } from '../../../../lib/workflow'

export type Variant = 'full' | 'path'
const SIZE = {
  full: { stage: [120, 176], small: [88, 176], check: [84, 76], gap: 26, step: 20, font: 11 },
  path: { stage: [108, 56], small: [84, 56], check: [76, 40], gap: 26, step: 16, font: 10 },
} as const

export type Placed = { id: string; x: number; y: number; w: number; h: number }
export type Edge = { key: string; from: string; to: string; outcome: string; back: boolean; dotted: boolean; d: string; label: { x: number; y: number } | null }
export type Layout = { width: number; height: number; nodes: Placed[]; edges: Edge[]; terminals: Map<string, { outcome: string; to: string }[]> }

type Arc = { key: string; from: number; to: number; outcome: string; up: boolean; back: boolean; level: number }

/**
 * Left-to-right layout of a workflow graph from the node order alone (no measuring, so it renders on the server): nodes in a row, adjacent forward edges as straight lines,
 * forward edges that skip nodes as arcs above, backward edges as dashed arcs below, nested by span so no two arcs share a lane where they overlap. A checkpoint that sits on the
 * way (plan gate, staging gate, production) joins its stage to the next stage; the refine checkpoint only hangs on its stage.
 */
export const layoutFlow = (g: Graph, variant: Variant): Layout => {
  const z = SIZE[variant]
  const index = new Map(g.nodes.map((n, i) => [n.id, i]))
  const isCheck = (i: number) => g.nodes[i]!.checkpoint && g.nodes[i]!.id.includes(':')
  const gatesOf = (stage: string) => {
    const out: number[] = []
    for (let i = index.get(stage)! + 1; i < g.nodes.length && g.nodes[i]!.id.startsWith(`${stage}:`); i++) if (!g.nodes[i]!.id.endsWith(':refine')) out.push(i)
    return out
  }
  const terminals = new Map<string, { outcome: string; to: string }[]>()
  type Straight = { key: string; from: number; to: number; outcome: string; dotted: boolean }
  const straight = new Map<string, Straight>()
  const arcs: Arc[] = []
  const add = (s: Straight) => straight.has(s.key) || straight.set(s.key, s)
  for (const n of g.nodes) {
    if (!n.id.includes(':')) continue
    const stage = n.id.slice(0, n.id.indexOf(':'))
    if (n.id.endsWith(':refine')) add({ key: `${n.id}~`, from: index.get(stage)!, to: index.get(n.id)!, outcome: '', dotted: true })
  }
  for (const e of g.edges) {
    const from = index.get(e.from)
    const to = index.get(e.to)
    if (from === undefined) continue
    if (to === undefined) {
      terminals.set(e.from, [...(terminals.get(e.from) ?? []), { outcome: e.outcome, to: e.to }])
      continue
    }
    if (from === to) continue
    const gates = gatesOf(e.from)
    if (to > from && gates.length && to === gates[gates.length - 1]! + 1) {
      const chain = [from, ...gates]
      chain.forEach((c, i) => i < chain.length - 1 && add({ key: `${g.nodes[c]!.id}~${g.nodes[chain[i + 1]!]!.id}`, from: c, to: chain[i + 1]!, outcome: '', dotted: true }))
      add({ key: `${e.from}>${e.to}:${e.outcome}`, from: gates[gates.length - 1]!, to, outcome: e.outcome, dotted: false })
    } else if (to === from + 1) add({ key: `${e.from}>${e.to}:${e.outcome}`, from, to, outcome: e.outcome, dotted: false })
    else arcs.push({ key: `${e.from}>${e.to}:${e.outcome}`, from, to, outcome: e.outcome, up: to > from, back: to < from, level: 0 })
  }

  const widths = g.nodes.map((n, i) => (isCheck(i) ? z.check[0] : n.kind === 'container' || n.kind === 'done' ? z.small[0] : z.stage[0]))
  const gaps = g.nodes.map((_, i) => {
    const label = [...straight.values()].filter((s) => s.from === i && s.to === i + 1 && s.outcome).map((s) => s.outcome.length)[0] ?? 0
    return Math.max(z.gap, Math.round(label * z.font * 0.62) + 12)
  })
  const xs: number[] = []
  widths.reduce((x, w, i) => (xs.push(x), x + w + gaps[i]!), 4)
  const width = xs[xs.length - 1]! + widths[widths.length - 1]! + 4

  for (const up of [true, false]) {
    const placed: Arc[] = []
    for (const a of arcs.filter((x) => x.up === up).sort((p, q) => Math.abs(p.to - p.from) - Math.abs(q.to - q.from) || Math.min(p.from, p.to) - Math.min(q.from, q.to))) {
      const [lo, hi] = [Math.min(a.from, a.to), Math.max(a.from, a.to)]
      let level = 1
      while (placed.some((p) => p.level === level && Math.min(p.from, p.to) < hi && lo < Math.max(p.from, p.to))) level++
      a.level = level
      placed.push(a)
    }
  }
  const lanes = (up: boolean) => Math.max(0, ...arcs.filter((a) => a.up === up).map((a) => a.level))
  const top = lanes(true) ? lanes(true) * z.step + 22 : 10
  const bottom = lanes(false) ? lanes(false) * z.step + 26 : 10
  const rowH = z.stage[1]
  const cy = top + rowH / 2
  const nodes: Placed[] = g.nodes.map((n, i) => {
    const h = isCheck(i) ? z.check[1] : rowH
    return { id: n.id, x: xs[i]!, y: cy - h / 2, w: widths[i]!, h }
  })

  const slot = (side: 'top' | 'bottom', node: number, arc: Arc) => {
    const mine = arcs.filter((a) => (a.up ? 'top' : 'bottom') === side && (a.from === node || a.to === node)).sort((p, q) => (p.from === node ? p.to : p.from) - (q.from === node ? q.to : q.from) || p.level - q.level)
    return xs[node]! + ((mine.indexOf(arc) + 1) * widths[node]!) / (mine.length + 1)
  }
  const edges: Edge[] = []
  for (const s of straight.values()) {
    const a = nodes[s.from]!
    const b = nodes[s.to]!
    const x1 = a.x + a.w
    edges.push({ key: s.key, from: g.nodes[s.from]!.id, to: g.nodes[s.to]!.id, outcome: s.outcome, back: false, dotted: s.dotted, d: `M${x1} ${cy}H${b.x}`, label: s.outcome ? { x: (x1 + b.x) / 2, y: cy - 6 } : null })
  }
  for (const a of arcs) {
    const sx = slot(a.up ? 'top' : 'bottom', a.from, a)
    const ex = slot(a.up ? 'top' : 'bottom', a.to, a)
    const y0 = a.up ? top : top + rowH
    const yl = a.up ? top - a.level * z.step : top + rowH + a.level * z.step
    const r = Math.min(8, Math.abs(ex - sx) / 2)
    const dir = ex > sx ? 1 : -1
    const away = a.up ? -1 : 1
    edges.push({
      key: a.key, from: g.nodes[a.from]!.id, to: g.nodes[a.to]!.id, outcome: a.outcome, back: a.back, dotted: false,
      d: `M${sx} ${y0}V${yl - away * r}Q${sx} ${yl} ${sx + dir * r} ${yl}H${ex - dir * r}Q${ex} ${yl} ${ex} ${yl - away * r}V${y0}`,
      label: { x: (sx + ex) / 2, y: a.up ? yl - 5 : yl + z.font + 4 },
    })
  }
  return { width, height: top + rowH + bottom, nodes, edges, terminals }
}
