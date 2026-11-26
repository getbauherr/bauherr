import { asDate, isEmpty, textValue } from './data-table-format'
import type { DataTableColumn, DataTableRow, DataTableSort, DataTableValue, IndexedRow } from './data-table-types'

const compareDates = (a: DataTableValue, b: DataTableValue) => {
  const first = asDate(a)
  const second = asDate(b)
  return first && second ? first.getTime() - second.getTime() : undefined
}
const comparePrimitive = (a: DataTableValue, b: DataTableValue) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length - b.length
  return undefined
}
const compareValues = (a: DataTableValue, b: DataTableValue, column: DataTableColumn, collator: Intl.Collator) => {
  if (isEmpty(a)) return isEmpty(b) ? 0 : 1
  if (isEmpty(b)) return -1
  const dateResult = column.format?.kind === 'date' ? compareDates(a, b) : undefined
  return dateResult ?? comparePrimitive(a, b) ?? collator.compare(textValue(a), textValue(b))
}
const collatorFor = (locale: string) => {
  try {
    return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  } catch {
    return new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })
  }
}
export const rowIdentifier = (row: DataTableRow, key: string | undefined, index: number) => {
  const value = key === undefined ? undefined : row[key]
  return value === null || value === undefined ? index : textValue(value)
}
export const sortRows = (
  rows: readonly DataTableRow[],
  columns: readonly DataTableColumn[],
  activeSort: DataTableSort | null | undefined,
  locale: string,
): IndexedRow[] => {
  const sortColumn = columns.find((column) => column.key === activeSort?.key)
  const indexedRows = rows.map((row, index) => ({ row, index }))
  if (!activeSort || !sortColumn) return indexedRows
  const collator = collatorFor(locale)
  return indexedRows.sort((a, b) => {
    const first = a.row[sortColumn.key]
    const second = b.row[sortColumn.key]
    const result = compareValues(first, second, sortColumn, collator)
    if (result === 0) return a.index - b.index
    if (isEmpty(first) || isEmpty(second)) return result
    return activeSort.direction === 'asc' ? result : -result
  })
}
