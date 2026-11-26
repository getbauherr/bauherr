import { useEffect, useState } from 'react'
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect'
import { isRelativeDateColumn, relativeRefreshDelay } from './data-table-format'
import type { DataTableColumn, DataTableRow, DataTableSort } from './data-table-types'

export const useRelativeTime = (
  columns: readonly DataTableColumn[],
  rows: readonly DataTableRow[],
  relativeTo: number | undefined,
) => {
  const hasRelativeDates = columns.some(isRelativeDateColumn)
  const [now, setNow] = useState<number>()
  useIsomorphicLayoutEffect(() => {
    if (relativeTo === undefined && hasRelativeDates) setNow(Date.now())
  }, [columns, rows, relativeTo, hasRelativeDates])
  const relativeTime = relativeTo ?? now
  const refreshDelay =
    relativeTo === undefined && hasRelativeDates && relativeTime !== undefined
      ? relativeRefreshDelay(columns, rows, relativeTime)
      : undefined
  useEffect(() => {
    if (refreshDelay === undefined) return
    const timeout = window.setTimeout(() => setNow(Date.now()), refreshDelay)
    return () => window.clearTimeout(timeout)
  }, [refreshDelay, relativeTime])
  return relativeTime
}

const nextSort = (activeSort: DataTableSort | null | undefined, key: string): DataTableSort | null => {
  if (activeSort?.key !== key) return { key, direction: 'asc' }
  return activeSort.direction === 'asc' ? { key, direction: 'desc' } : null
}
const announcementFor = (next: DataTableSort | null, label: string) => {
  if (!next) return 'Sorting cleared'
  return `Sorted by ${label}, ${next.direction === 'asc' ? 'ascending' : 'descending'}`
}

export const useSortState = (
  defaultSort: DataTableSort | undefined,
  sort: DataTableSort | null | undefined,
  onSortChange: ((sort: DataTableSort | null) => void) | undefined,
) => {
  const [internalSort, setInternalSort] = useState<DataTableSort | null>(defaultSort ?? null)
  const [announcement, setAnnouncement] = useState('')
  const activeSort = sort === undefined ? internalSort : sort
  const changeSort = (column: DataTableColumn) => {
    const next = nextSort(activeSort, column.key)
    if (sort === undefined) setInternalSort(next)
    setAnnouncement(announcementFor(next, column.label))
    onSortChange?.(next)
  }
  return { activeSort, announcement, changeSort }
}
