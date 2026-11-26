import { cn } from '@/lib/utils'
import { alignOf } from './data-table-format'
import { rowIdentifier } from './data-table-sort'
import type { DataTableColumn, DataTableSort, IndexedRow } from './data-table-types'
import { Value } from './data-table-value'
import { mono } from './surfaces'

interface ViewProps {
  columns: readonly DataTableColumn[]
  rows: readonly IndexedRow[]
  rowKey: string | undefined
  locale: string
  relativeTo: number | undefined
  emptyMessage: string
}

function SortButton({
  column,
  direction,
  onSort,
}: {
  column: DataTableColumn
  direction: 'asc' | 'desc' | undefined
  onSort: (column: DataTableColumn) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      aria-label={`Sort by ${column.label}`}
      className="focus-visible:ring-foreground/20 -mx-1 rounded px-1 outline-none focus-visible:ring-1"
    >
      {column.label}
      {direction ? (
        <span aria-hidden className="ms-1">
          {direction === 'asc' ? '↑' : '↓'}
        </span>
      ) : null}
    </button>
  )
}

function HeaderCell({
  column,
  activeSort,
  onSort,
}: {
  column: DataTableColumn
  activeSort: DataTableSort | null
  onSort: (column: DataTableColumn) => void
}) {
  const direction = activeSort?.key === column.key ? activeSort.direction : undefined
  return (
    <th
      scope="col"
      {...(direction ? { 'aria-sort': direction === 'asc' ? 'ascending' : 'descending' } : {})}
      style={column.width ? { width: column.width } : undefined}
      className={cn(
        mono,
        'text-muted-foreground px-4 py-3 font-medium',
        alignOf(column) === 'end' ? 'text-end' : 'text-start',
      )}
    >
      {column.sortable !== false ? <SortButton column={column} direction={direction} onSort={onSort} /> : column.label}
    </th>
  )
}

const cellClass = (column: DataTableColumn) =>
  cn(
    'text-foreground/80 px-4 py-2.5 align-top text-[13px] leading-5',
    alignOf(column) === 'end' && 'text-end tabular-nums',
  )

export function TableView({
  columns,
  rows,
  rowKey,
  locale,
  relativeTo,
  emptyMessage,
  caption,
  activeSort,
  onSort,
}: ViewProps & {
  caption: string | undefined
  activeSort: DataTableSort | null
  onSort: (column: DataTableColumn) => void
}) {
  return (
    <table className="hidden w-full border-collapse @md:table">
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <thead className="border-foreground/10 border-b">
        <tr>
          {columns.map((column) => (
            <HeaderCell key={column.key} column={column} activeSort={activeSort} onSort={onSort} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={Math.max(columns.length, 1)}
              className="text-muted-foreground px-4 py-6 text-center text-[13px]"
            >
              <span role="status">{emptyMessage}</span>
            </td>
          </tr>
        ) : (
          rows.map(({ row, index }) => (
            <tr
              key={rowIdentifier(row, rowKey, index)}
              className="hover:bg-foreground/[0.025] transition-colors motion-reduce:transition-none"
            >
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  <Value column={column} row={row} locale={locale} relativeTo={relativeTo} />
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function ListItem({
  row,
  columns,
  primaryColumn,
  locale,
  relativeTo,
}: Pick<ViewProps, 'columns' | 'locale' | 'relativeTo'> & {
  row: IndexedRow['row']
  primaryColumn: DataTableColumn | undefined
}) {
  return (
    <div
      role="listitem"
      className={cn(
        'bg-foreground/[0.025] hover:bg-foreground/[0.04] rounded-xl px-3 py-2',
        'transition-colors motion-reduce:transition-none',
      )}
    >
      {primaryColumn ? (
        <div className="text-foreground/90 text-[13px] leading-5 font-medium">
          <Value column={primaryColumn} row={row} locale={locale} relativeTo={relativeTo} />
        </div>
      ) : null}
      {columns.length > 1 ? (
        <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] leading-4 @xs:grid-cols-2">
          {columns
            .filter((column) => column.key !== primaryColumn?.key)
            .map((column) => (
              <div key={column.key} className="flex min-w-0 items-baseline justify-between gap-2">
                <dt className="text-muted-foreground truncate">{column.label}</dt>
                <dd className="text-foreground/75 shrink-0 text-end tabular-nums">
                  <Value column={column} row={row} locale={locale} relativeTo={relativeTo} />
                </dd>
              </div>
            ))}
        </dl>
      ) : null}
    </div>
  )
}

export function ListView({ columns, rows, rowKey, locale, relativeTo, emptyMessage }: ViewProps) {
  const primaryColumn = columns.find((column) => column.priority === 'primary') ?? columns[0]
  return (
    <div role="list" className="space-y-2 p-2.5 @md:hidden">
      {rows.length === 0 ? (
        <div role="status" className="text-muted-foreground px-2 py-3 text-center text-[13px]">
          {emptyMessage}
        </div>
      ) : (
        rows.map(({ row, index }) => (
          <ListItem
            key={rowIdentifier(row, rowKey, index)}
            row={row}
            columns={columns}
            primaryColumn={primaryColumn}
            locale={locale}
            relativeTo={relativeTo}
          />
        ))
      )}
    </div>
  )
}
