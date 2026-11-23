import type { StatementRecord } from '../../../core/views/statement-records'

export const SHOWS = ['all', 'new', 'said', 'agents', 'back', 'off'] as const
export type Show = (typeof SHOWS)[number]

export const SHOW_LABELS: Record<Show, string> = {
  all: 'All',
  new: 'New',
  said: 'You said',
  agents: 'Agents found',
  back: 'Came back',
  off: 'Off',
}

const KEPT: Record<Show, (record: StatementRecord) => boolean> = {
  all: () => true,
  new: (record) => record.isNew,
  said: (record) => record.kind !== 'learned',
  agents: (record) => record.kind === 'learned',
  back: (record) => record.cameBack > 0,
  off: (record) => record.off,
}

export const parseShow = (value: string | undefined): Show => SHOWS.find((show) => show === value) ?? 'all'

export const filterHref = (show: Show, product: number): string =>
  `/memory?product=${product}${show === 'all' ? '' : `&show=${show}`}`

export const keep = (records: StatementRecord[], show: Show): StatementRecord[] => records.filter(KEPT[show])

export const countsOf = (records: StatementRecord[]): Record<Show, number> =>
  Object.fromEntries(SHOWS.map((show) => [show, keep(records, show).length])) as Record<Show, number>
