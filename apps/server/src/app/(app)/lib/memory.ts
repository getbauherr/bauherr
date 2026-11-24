import type { StatementRecord } from '../../../core/views/statement-records'

export const SHOWS = ['all', 'said', 'agents', 'off'] as const
export type Show = (typeof SHOWS)[number]

export const SHOW_LABELS: Record<Show, string> = {
  all: 'All',
  said: 'You said',
  agents: 'Agents found',
  off: 'Off',
}

const KEPT: Record<Show, (record: StatementRecord) => boolean> = {
  all: () => true,
  said: (record) => record.kind !== 'learned',
  agents: (record) => record.kind === 'learned',
  off: (record) => record.off,
}

export const parseShow = (value: string | undefined): Show => SHOWS.find((show) => show === value) ?? 'all'

export const filterHref = (show: Show, product: number): string =>
  `/memory?product=${product}${show === 'all' ? '' : `&show=${show}`}`

export const keep = (records: StatementRecord[], show: Show): StatementRecord[] => records.filter(KEPT[show])

export const countsOf = (records: StatementRecord[]): Record<Show, number> =>
  Object.fromEntries(SHOWS.map((show) => [show, keep(records, show).length])) as Record<Show, number>
