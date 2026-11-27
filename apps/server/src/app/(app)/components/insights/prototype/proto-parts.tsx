'use client'

import { cn } from '@/lib/utils'
import { Button } from '../../ui/button'
import { PERIODS, type Period } from './proto-data'

export function PeriodSwitch({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div role="group" aria-label="Range" className="flex items-center gap-2">
      {PERIODS.map((period) => (
        <Button
          key={period}
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={period === value}
          onClick={() => onChange(period)}
          className={cn(period === value && 'border-primary bg-accent')}
        >
          {period} days
        </Button>
      ))}
    </div>
  )
}

export function Sparkline({ series, label }: { series: number[]; label: string }) {
  const max = Math.max(...series, 0.01)
  const step = 96 / Math.max(series.length - 1, 1)
  const points = series.map((value, index) => `${(index * step).toFixed(1)},${(26 - (value / max) * 24).toFixed(1)}`)
  return (
    <svg role="img" aria-label={label} viewBox="0 0 96 28" className="h-7 w-24 text-chart-1">
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function ShareBar({ share }: { share: number }) {
  const label = `${Math.round(share * 100)}% of cost`
  return (
    <div className="flex items-center gap-2">
      <div role="img" aria-label={label} className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-chart-1" style={{ width: `${Math.max(share * 100, 1)}%` }} />
      </div>
      <span className="mono w-9 text-right">{Math.round(share * 100)}%</span>
    </div>
  )
}

export function Figure({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="small order-2 text-muted-foreground">{label}</dt>
      <dd className="order-1 m-0 text-2xl font-semibold leading-[30px] tabular-nums">{value}</dd>
      {hint && <dd className="small order-3 m-0 text-muted-foreground">{hint}</dd>}
    </div>
  )
}
