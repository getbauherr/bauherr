import type { Payload } from 'payload'
import { z } from 'zod'
import type { Stage } from '../../../core/events'
import { board, type Board, type BoardCard } from '../../../core/views/board'
import { holds } from '../../../core/views/holds'
import { somedayCounts, type SomedayCount } from '../../../core/views/someday'
import type { BoardView } from './board-relations'
import { webOrigin } from '../../../lib/connection'
import { stageStats, type StageStat, type Stats } from '../../../core/views/stats'

export const SHOWS = ['all', 'you', 'working', 'stuck', 'others'] as const
export type Show = (typeof SHOWS)[number]
export const STAGE_NAMES: Record<Stage, string> = {
  intake: 'Intake',
  brief: 'Brief',
  build: 'Build',
  verify: 'Verify',
  ship: 'Ship',
  done: 'Done',
}

export type Who = Exclude<Show, 'all'>

export const SHOW_LABELS: Record<Show, string> = {
  all: 'All',
  you: 'Waiting on you',
  working: 'Agents working',
  stuck: 'Stuck',
  others: 'Waiting on others',
}

const search = z.object({
  show: z.enum(SHOWS).catch('all'),
  product: z.coerce.number().int().positive().optional().catch(undefined),
})

export const parseSearch = (raw: { show?: string; product?: string }): { show: Show; product?: number } => {
  const parsed = search.parse(raw)
  return parsed.product === undefined ? { show: parsed.show } : { show: parsed.show, product: parsed.product }
}

export const whoOf = (card: Pick<BoardCard, 'state' | 'stage'>): Who | null => {
  if (card.stage === 'done') return null
  if (card.state === 'stuck') return 'stuck'
  if (card.state === 'owner') return 'you'
  if (card.state === 'agents') return 'working'
  return 'others'
}

export const isDimmed = (show: Show, who: Who | null): boolean =>
  show !== 'all' && who !== show && !(show === 'you' && who === 'stuck')

export const filterHref = (show: Show, product?: number, view: BoardView = { group: false }): string => {
  const query = new URLSearchParams()
  if (show !== 'all') query.set('show', show)
  if (product !== undefined) query.set('product', String(product))
  if (view.relation !== undefined) query.set('relation', view.relation)
  if (view.group) query.set('group', 'parent')
  const text = query.toString()
  return text ? `/?${text}` : '/'
}

export const productsIn = async (payload: Payload, workspace: number): Promise<{ id: number; name: string }[]> => {
  const found = await payload.find({
    collection: 'products',
    where: { workspace: { equals: workspace } },
    sort: 'name',
    pagination: false,
    depth: 0,
    select: { name: true },
    overrideAccess: true,
  })
  return found.docs.map((doc) => ({ id: z.coerce.number().parse(doc.id), name: z.string().parse(doc.name) }))
}

export const LANE_PAGE = 30

export const loadFactory = async (
  payload: Payload,
  input: { workspace: number; product?: number },
  chunked: boolean,
) => {
  const now = new Date()
  const filter = input.product === undefined ? { workspace: input.workspace, now } : { ...input, now }
  const [lanes, stats, held, someday, products] = await Promise.all([
    board(payload, filter, chunked ? LANE_PAGE : undefined),
    stageStats(payload, filter),
    holds(payload, { workspace: input.workspace, now }),
    somedayCounts(payload, input),
    productsIn(payload, input.workspace),
  ])
  return { lanes, stats, held, someday, products }
}

export const somedayHref = (item: Pick<SomedayCount, 'forge' | 'repo' | 'config'>): string => {
  const base = `${webOrigin({ kind: item.forge, config: item.config })}/${item.repo}`
  return item.forge === 'gitlab'
    ? `${base}/-/issues?label_name[]=bauherr:someday`
    : `${base}/issues?q=is:open+label:bauherr:someday`
}

export type Worker = { key: string; mark: 'R' | 'S'; title: string }

export const workerOf = (leasedBy: string): { mark: 'R' | 'S'; name: string } =>
  leasedBy.startsWith('runner-')
    ? { mark: 'R', name: 'Runner' }
    : { mark: 'S', name: `Session ${leasedBy.slice(0, 8)}` }

export const countShows = (lanes: Board, stats: Stats): Record<Show, number> => {
  const parked = lanes.parked.length + lanes.held.length
  const tally: Record<Show, number> = { all: parked, you: 0, working: 0, stuck: 0, others: parked }
  for (const { stage, counts } of stats.stages) {
    if (stage === 'done') continue
    tally.all += counts.owner + counts.agents + counts.stuck + counts.others
    tally.you += counts.owner + counts.stuck
    tally.working += counts.agents
    tally.stuck += counts.stuck
    tally.others += counts.others
  }
  return tally
}

const workerOn = (run: StageStat['runs'][number], leasedBy: string): Worker => {
  const { mark, name } = workerOf(leasedBy)
  return { key: `${run.recordId}-${leasedBy}`, mark, title: `${name} on #${run.number}` }
}

export const workersOf = (stat: StageStat): Worker[] =>
  stat.runs.flatMap((run) => (run.leasedBy === null ? [] : [workerOn(run, run.leasedBy)]))
