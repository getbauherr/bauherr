'use client'

import { cn } from '@/lib/utils'
import { mono, paper } from './surfaces'
import { ChartDelta, ChartSvg, resolveTrend, type ChartProps } from './chart.parts'

export type { ChartVariant } from './chart.parts'

export function Chart({
  label,
  value,
  delta,
  points,
  visibleCount,
  variant = 'area',
  trend,
  upIsGood = true,
  className,
  ...props
}: ChartProps) {
  const direction = resolveTrend(trend, delta)
  return (
    <div
      data-slot="chart"
      className={cn(paper, 'flex w-full max-w-sm flex-col gap-3 rounded-2xl p-4', className)}
      {...props}
    >
      <div className="flex items-baseline justify-between">
        <span className={cn(mono, 'text-muted-foreground')}>{label}</span>
        {delta !== undefined && <ChartDelta delta={delta} direction={direction} upIsGood={upIsGood} />}
      </div>

      <span className="text-2xl font-medium tracking-tight tabular-nums">{value}</span>

      <ChartSvg label={label} value={value} points={points} visibleCount={visibleCount} variant={variant} />
    </div>
  )
}
