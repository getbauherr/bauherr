import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { mono } from './surfaces'
import { clamp, take } from '../utils/range'

export type ChartVariant = 'area' | 'line' | 'bars'

type Trend = 'up' | 'down' | 'flat'

export type ChartProps = Omit<
  ComponentProps<'div'>,
  'children' | 'label' | 'value' | 'delta' | 'points' | 'visibleCount' | 'variant' | 'trend' | 'upIsGood'
> & {
  label: string
  value: string
  delta?: string | undefined
  points: readonly number[]
  visibleCount: number
  variant?: ChartVariant | undefined
  trend?: Trend | undefined
  upIsGood?: boolean | undefined
}

type Coord = { x: number; y: number }

const W = 300
const H = 88
const PAD = 6

const scale = (points: readonly number[]) => {
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  return (value: number) => H - PAD - ((value - min) / span) * (H - PAD * 2)
}

function deltaTrend(delta: string): Trend {
  if (/\d/.test(delta) && !/[1-9]/.test(delta)) {
    return 'flat'
  }
  return /^\s*[-−–]/.test(delta) ? 'down' : 'up'
}

export function resolveTrend(trend: Trend | undefined, delta: string | undefined): Trend | undefined {
  if (trend !== undefined) {
    return trend
  }
  return delta === undefined ? undefined : deltaTrend(delta)
}

function deltaColor(direction: Trend | undefined, upIsGood: boolean) {
  if (direction !== 'up' && direction !== 'down') {
    return 'text-muted-foreground'
  }
  return (direction === 'up') === upIsGood ? 'text-ok ' : 'text-danger '
}

export function ChartDelta({
  delta,
  direction,
  upIsGood,
}: {
  delta: string
  direction: Trend | undefined
  upIsGood: boolean
}) {
  return (
    <span data-trend={direction} className={cn(mono, 'tabular-nums', deltaColor(direction, upIsGood))}>
      {delta}
    </span>
  )
}

function ChartBars({
  shown,
  y,
  x,
  step,
}: {
  shown: readonly number[]
  y: (value: number) => number
  x: (i: number) => number
  step: number
}) {
  const lastIndex = shown.length - 1
  const barWidth = Math.max(2, step * 0.55)
  return shown.map((p, i) => {
    const top = y(p)
    return (
      <rect
        key={i}
        x={x(i) - barWidth / 2}
        y={top}
        width={barWidth}
        height={Math.max(1, H - PAD - top)}
        rx="1.5"
        className={cn(
          'fade-in animate-in fill-mode-both duration-300',
          i === lastIndex ? 'fill-primary ' : 'fill-foreground/25',
        )}
        style={{ animationDelay: `${i * 40}ms` }}
      />
    )
  })
}

function ChartLine({ coords, filled }: { coords: readonly Coord[]; filled: boolean }) {
  const line = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const last = coords.at(-1)
  const area = last
    ? `M ${PAD},${H - PAD} ${coords.map((c) => `L ${c.x},${c.y}`).join(' ')} L ${last.x},${H - PAD} Z`
    : ''
  return (
    <>
      {filled && coords.length > 1 && <path d={area} className="fill-primary/12 " />}
      <polyline
        points={line}
        fill="none"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-primary "
      />
      {last && <circle cx={last.x} cy={last.y} r="3" className="fill-primary " />}
    </>
  )
}

export function ChartSvg({
  label,
  value,
  points,
  visibleCount,
  variant,
}: Pick<ChartProps, 'label' | 'value' | 'points' | 'visibleCount'> & { variant: ChartVariant }) {
  const shown = take(points, clamp(visibleCount, 1, points.length))
  const y = scale(points)
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0
  const x = (i: number) => PAD + i * step
  const coords = shown.map((p, i) => ({ x: x(i), y: y(p) }))
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label}: ${value}`}
      className="h-[88px] w-full overflow-visible"
      preserveAspectRatio="none"
    >
      <line
        x1="0"
        x2={W}
        y1={H - PAD}
        y2={H - PAD}
        className="stroke-foreground/[0.08]"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {variant === 'bars' ? (
        <ChartBars shown={shown} y={y} x={x} step={step} />
      ) : (
        <ChartLine coords={coords} filled={variant === 'area'} />
      )}
    </svg>
  )
}
