import { cn } from '@/lib/utils'

const WIDTH = 120
const HEIGHT = 32

const pointsOf = (values: (number | null)[]): string => {
  const known = values.filter((value): value is number => value !== null)
  const low = Math.min(...known)
  const span = Math.max(...known) - low || 1
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0
  const y = (value: number) => (HEIGHT - 3 - ((value - low) / span) * (HEIGHT - 6)).toFixed(1)
  const point = (value: number | null, index: number) =>
    value === null ? [] : [`${(index * step).toFixed(1)},${y(value)}`]
  return values.flatMap(point).join(' ')
}

export function Chart({
  label,
  value,
  delta,
  values,
  off,
}: {
  label: string
  value: string
  delta: string | null
  values: (number | null)[]
  off: boolean
}) {
  const drawn = values.some((point) => point !== null)
  return (
    <div
      data-slot="chart"
      data-off={off}
      className={cn('grid gap-1 rounded-2xl border bg-card p-3', off ? 'border-destructive' : 'border-border')}
    >
      <span className="small text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className={cn('small tabular-nums', off ? 'text-destructive' : 'text-muted-foreground')}>
        {delta ?? 'no change'}
        {off && <span className="sr-only"> (far off)</span>}
      </span>
      {drawn && (
        <svg
          role="img"
          aria-label={`${label} over the last Retros`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-8 w-full"
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            points={pointsOf(values)}
            className={off ? 'text-destructive' : 'text-primary'}
          />
        </svg>
      )}
    </div>
  )
}
