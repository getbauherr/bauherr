import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { safeHref } from '../utils/href'
import {
  DATE_ONLY,
  asDate,
  fractionDigits,
  formatted,
  isEmpty,
  numberOptions,
  numericValue,
  relativeDate,
  textValue,
  withUnit,
} from './data-table-format'
import type { DataTableColumn, DataTableFormat, DataTableRow, PresentValue } from './data-table-types'
import { field } from './surfaces'

type FormatOf<K extends DataTableFormat['kind']> = Extract<DataTableFormat, { kind: K }>
type NumericFormat = FormatOf<'number' | 'currency' | 'percent' | 'delta'>
interface Context {
  value: PresentValue
  row: DataTableRow
  locale: string
  relativeTo: number | undefined
}

const formatNumeric = (format: NumericFormat, number: number, locale: string) => {
  switch (format.kind) {
    case 'number':
      return new Intl.NumberFormat(locale, numberOptions(format.decimals, format.compact === true)).format(number)
    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: format.currency,
        ...numberOptions(format.decimals, format.compact === true),
      }).format(number)
    case 'percent':
      return new Intl.NumberFormat(locale, { style: 'percent', ...fractionDigits(format.decimals) }).format(
        format.basis === 'unit' ? number / 100 : number,
      )
    case 'delta':
      return new Intl.NumberFormat(locale, { signDisplay: 'never', ...fractionDigits(format.decimals) }).format(number)
  }
}

const deltaDirection = (number: number) => {
  if (number > 0) return '↑'
  return number < 0 ? '↓' : '→'
}
const deltaClass = (number: number, upIsGood: boolean) => {
  if (number === 0) return 'text-muted-foreground'
  return number > 0 === upIsGood ? 'text-ok ' : 'text-danger '
}

const renderNumeric = (format: NumericFormat, { value, locale }: Context): ReactNode => {
  const number = numericValue(value)
  if (number === undefined) return textValue(value)
  const content = formatted(value, () => formatNumeric(format, number, locale))
  if (format.kind === 'delta') {
    return (
      <span className={cn(deltaClass(number, format.upIsGood ?? true))}>
        {deltaDirection(number)} {withUnit(content, format.unit)}
      </span>
    )
  }
  return withUnit(content, format.kind === 'number' ? format.unit : undefined)
}

const dateOptions = (style: 'date' | 'datetime' | 'relative', value: PresentValue, relativeTo: number | undefined) => {
  if (style === 'datetime') return { dateStyle: 'medium', timeStyle: 'short' } as const
  const utc = (style === 'relative' && relativeTo === undefined) || (typeof value === 'string' && DATE_ONLY.test(value))
  return utc ? ({ dateStyle: 'medium', timeZone: 'UTC' } as const) : ({ dateStyle: 'medium' } as const)
}

const renderDate = (format: FormatOf<'date'>, { value, locale, relativeTo }: Context): ReactNode => {
  const date = asDate(value)
  if (!date) return textValue(value)
  const style = format.style ?? 'date'
  const content = formatted(value, () =>
    style === 'relative' && relativeTo !== undefined
      ? relativeDate(date, locale, relativeTo)
      : new Intl.DateTimeFormat(locale, dateOptions(style, value, relativeTo)).format(date),
  )
  return <span title={date.toISOString()}>{content}</span>
}

const renderLink = (format: FormatOf<'link'>, { value, row }: Context): ReactNode => {
  const hrefValue = format.hrefKey ? row[format.hrefKey] : value
  const href = safeHref(typeof hrefValue === 'string' ? hrefValue : undefined)
  if (!href) return textValue(value)
  if (!/^https?:/.test(href)) {
    return (
      <a href={href} className="underline underline-offset-2">
        {textValue(value)}
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
      {textValue(value)}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

const TONE_CLASS = {
  neutral: cn(field, 'text-foreground/75'),
  success: 'bg-ok/12 text-ok ',
  warning: 'bg-warn/12 text-warn ',
  danger: 'bg-danger/12 text-danger ',
}

const renderBadge = (format: FormatOf<'badge'>, { value }: Context): ReactNode => {
  const tone = format.tones?.[textValue(value)] ?? 'neutral'
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', TONE_CLASS[tone])}>
      {textValue(value)}
    </span>
  )
}

const renderList = (format: FormatOf<'list'>, { value }: Context): ReactNode => {
  if (!Array.isArray(value)) return textValue(value)
  const shown = value.slice(0, Math.max(0, Math.floor(format.max ?? value.length)))
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((item, index) => (
        <span key={index} className={cn(field, 'text-foreground/75 rounded-md px-1.5 py-0.5 text-xs')}>
          {item}
        </span>
      ))}
      {value.length > shown.length ? (
        <span className="text-muted-foreground px-1.5 py-0.5 text-xs">+{value.length - shown.length}</span>
      ) : null}
    </span>
  )
}

const renderBoolean = (format: FormatOf<'boolean'>, { value }: Context): ReactNode => {
  if (typeof value !== 'boolean') return textValue(value)
  return value ? (format.trueLabel ?? 'Yes') : (format.falseLabel ?? 'No')
}

const renderByFormat = (format: DataTableFormat, context: Context): ReactNode => {
  switch (format.kind) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'delta':
      return renderNumeric(format, context)
    case 'date':
      return renderDate(format, context)
    case 'boolean':
      return renderBoolean(format, context)
    case 'link':
      return renderLink(format, context)
    case 'badge':
      return renderBadge(format, context)
    case 'list':
      return renderList(format, context)
    default:
      return textValue(context.value)
  }
}

const EmptyValue = () => <span className="text-muted-foreground">none</span>

export function Value({
  column,
  row,
  locale,
  relativeTo,
}: {
  column: DataTableColumn
  row: DataTableRow
  locale: string
  relativeTo: number | undefined
}) {
  const value = row[column.key]
  if (isEmpty(value)) return <EmptyValue />
  return <>{renderByFormat(column.format ?? { kind: 'text' }, { value, row, locale, relativeTo })}</>
}
