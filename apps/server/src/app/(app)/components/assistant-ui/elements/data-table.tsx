'use client'

import { cn } from '@/lib/utils'
import { useRelativeTime, useSortState } from './data-table-hooks'
import { sortRows } from './data-table-sort'
import type { DataTableProps } from './data-table-types'
import { ListView, TableView } from './data-table-views'
import { paper } from './surfaces'

export type {
  DataTableColumn,
  DataTableFormat,
  DataTableProps,
  DataTableRow,
  DataTableSort,
  DataTableValue,
} from './data-table-types'

export function DataTable({
  columns,
  rows,
  rowKey,
  caption,
  defaultSort,
  sort,
  onSortChange,
  locale = 'en-US',
  emptyMessage = 'No rows',
  relativeTo,
  className,
  ...props
}: DataTableProps) {
  const { activeSort, announcement, changeSort } = useSortState(defaultSort, sort, onSortChange)
  const relativeTime = useRelativeTime(columns, rows, relativeTo)
  const sortedRows = sortRows(rows, columns, activeSort, locale)
  const view = { columns, rows: sortedRows, rowKey, locale, relativeTo: relativeTime, emptyMessage }
  return (
    <div
      data-slot="data-table"
      className={cn(paper, '@container w-full overflow-hidden rounded-2xl', className)}
      {...props}
    >
      <TableView {...view} caption={caption} activeSort={activeSort} onSort={changeSort} />
      <ListView {...view} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
