import type { Totals } from '../../../../core/views/totals'
import { duration } from '../../lib/format'

const orDash = (value: number | null, show: (n: number) => string): string => (value === null ? '—' : show(value))

export function TotalsLine({ totals }: { totals: Totals }) {
  const rate = orDash(totals.firstPassAcceptRate, (value) => `${Math.round(value * 100)}%`)
  return (
    <p className="small ml-auto text-muted-foreground">
      Last 7 days: shipped <span className="mono">{totals.shippedLast7Days}</span> · Last 30 days: median time to
      ship <span className="mono">{orDash(totals.medianSecondsToAccept, duration)}</span> · first-pass accept{' '}
      <span className="mono">{rate}</span>
    </p>
  )
}
