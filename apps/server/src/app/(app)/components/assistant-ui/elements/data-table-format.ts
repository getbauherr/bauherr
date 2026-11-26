import { clamp } from '../utils/range'
import type { DataTableColumn, DataTableFormat, DataTableRow, DataTableValue, PresentValue } from './data-table-types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export const isEmpty = (value: DataTableValue): value is null | undefined => value === null || value === undefined
export const textValue = (value: PresentValue) => (Array.isArray(value) ? value.join(', ') : String(value))
const isLeapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
const daysInMonth = (year: number, month: number) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
const isCalendarDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    return false
  }
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}
const parseTimestamp = (value: DataTableValue) => {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && ISO_DATE.test(value) && isCalendarDate(value)) return Date.parse(value)
  return Number.NaN
}
export const asDate = (value: DataTableValue) => {
  const timestamp = parseTimestamp(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp)
}
export const fractionDigits = (decimals: number | undefined) =>
  decimals === undefined || !Number.isFinite(decimals)
    ? {}
    : {
        minimumFractionDigits: Math.floor(clamp(decimals, 0, 20)),
        maximumFractionDigits: Math.floor(clamp(decimals, 0, 20)),
      }
export const numberOptions = (decimals: number | undefined, compact: boolean) => ({
  notation: compact ? ('compact' as const) : ('standard' as const),
  ...fractionDigits(decimals),
})
export const formatted = (value: PresentValue, format: () => string) => {
  try {
    return format()
  } catch {
    return textValue(value)
  }
}
export const numericValue = (value: DataTableValue) =>
  typeof value === 'number' && !Number.isNaN(value) ? value : undefined
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]
export const relativeDate = (date: Date, locale: string, relativeTo: number) => {
  const seconds = Math.round((date.getTime() - relativeTo) / 1000)
  const [unit, amount] = RELATIVE_UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1]
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / amount), unit)
}
export const isRelativeDateColumn = (column: DataTableColumn) =>
  column.format?.kind === 'date' && column.format.style === 'relative'
const REFRESH_STEPS: readonly [number, number][] = [
  [60000, 1000],
  [3600000, 30000],
  [86400000, 60000],
  [604800000, 3600000],
]
export const relativeRefreshDelay = (
  columns: readonly DataTableColumn[],
  rows: readonly DataTableRow[],
  now: number,
) => {
  const relativeKeys = columns.filter(isRelativeDateColumn).map((column) => column.key)
  const freshestAge = rows.reduce((minimum, row) => {
    for (const key of relativeKeys) {
      const date = asDate(row[key])
      if (date) minimum = Math.min(minimum, Math.abs(now - date.getTime()))
    }
    return minimum
  }, Number.POSITIVE_INFINITY)
  return REFRESH_STEPS.find(([limit]) => freshestAge < limit)?.[1] ?? 86400000
}
export const withUnit = (text: string, unit: string | undefined) => {
  if (unit === undefined || unit === '') return text
  return /^[%‰°]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`
}
export const isNumeric = (format: DataTableFormat | undefined) =>
  format?.kind === 'number' || format?.kind === 'currency' || format?.kind === 'percent' || format?.kind === 'delta'
export const alignOf = (column: DataTableColumn) => column.align ?? (isNumeric(column.format) ? 'end' : 'start')
