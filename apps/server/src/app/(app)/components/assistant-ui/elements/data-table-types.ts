import type { ComponentProps } from 'react'
export type DataTableValue = string | number | boolean | null | undefined | readonly (string | number)[]
export type DataTableRow = Readonly<Record<string, DataTableValue>>
export type DataTableFormat =
  | {
      kind: 'text'
    }
  | {
      kind: 'number'
      decimals?: number | undefined
      compact?: boolean | undefined
      unit?: string | undefined
    }
  | {
      kind: 'currency'
      currency: string
      decimals?: number | undefined
      compact?: boolean | undefined
    }
  | {
      kind: 'percent'
      decimals?: number | undefined
      basis?: 'fraction' | 'unit' | undefined
    }
  | {
      kind: 'delta'
      decimals?: number | undefined
      unit?: string | undefined
      upIsGood?: boolean | undefined
    }
  | {
      kind: 'date'
      style?: 'date' | 'datetime' | 'relative' | undefined
    }
  | {
      kind: 'boolean'
      trueLabel?: string | undefined
      falseLabel?: string | undefined
    }
  | {
      kind: 'link'
      hrefKey?: string | undefined
    }
  | {
      kind: 'badge'
      tones?: Readonly<Record<string, 'neutral' | 'success' | 'warning' | 'danger'>> | undefined
    }
  | {
      kind: 'list'
      max?: number | undefined
    }
export interface DataTableColumn {
  key: string
  label: string
  format?: DataTableFormat | undefined
  align?: 'start' | 'end' | undefined
  sortable?: boolean | undefined
  priority?: 'primary' | 'secondary' | undefined
  width?: string | undefined
}
export interface DataTableSort {
  key: string
  direction: 'asc' | 'desc'
}
export interface DataTableProps extends Omit<ComponentProps<'div'>, 'children'> {
  columns: readonly DataTableColumn[]
  rows: readonly DataTableRow[]
  rowKey?: string | undefined
  caption?: string | undefined
  defaultSort?: DataTableSort | undefined
  sort?: DataTableSort | null | undefined
  onSortChange?: ((sort: DataTableSort | null) => void) | undefined
  locale?: string | undefined
  emptyMessage?: string | undefined
  relativeTo?: number | undefined
}
export type PresentValue = Exclude<DataTableValue, null | undefined>
export interface IndexedRow {
  row: DataTableRow
  index: number
}
