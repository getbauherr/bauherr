import type { StatementRecord } from '../../../core/views/statement-records'

export const SHOWS = ['all', 'said', 'back', 'off'] as const
export type Show = (typeof SHOWS)[number]

export const SHOW_LABELS: Record<Show, string> = {
  all: 'All',
  said: 'You said',
  back: 'Came back',
  off: 'Off',
}

const KEPT: Record<Show, (record: StatementRecord) => boolean> = {
  all: () => true,
  said: () => true,
  back: (record) => record.cameBack > 0,
  off: (record) => record.off,
}

export const parseShow = (value: string | undefined): Show => SHOWS.find((show) => show === value) ?? 'all'

export const filterHref = (show: Show, product: number): string =>
  `/memory?product=${product}${show === 'all' ? '' : `&show=${show}`}`

export const keep = (records: StatementRecord[], show: Show): StatementRecord[] => records.filter(KEPT[show])

export const countsOf = (records: StatementRecord[]): Record<Show, number> => ({
  all: keep(records, 'all').length,
  said: keep(records, 'said').length,
  back: keep(records, 'back').length,
  off: keep(records, 'off').length,
})
