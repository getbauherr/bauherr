import { cn } from '@/lib/utils'
import type { StageStat } from '../../../../core/views/stats'
import { STATES } from '../../../../core/views/status'
import { STAGE_NAMES, type Worker } from '../../lib/factory'
import { duration } from '../../lib/format'

const STATE_WORDS = { owner: 'for you', agents: 'working', stuck: 'stuck', others: 'on others' } as const
const STATE_BARS = { owner: 'bg-warn', agents: 'bg-primary', stuck: 'bg-destructive', others: 'bg-muted-foreground' }

const HEADER = 'relative mb-2 grid content-start md:mb-13 md:h-31 gap-1.5 rounded-md border border-border bg-card p-3'
const ARROW = cn(
  "before:absolute before:top-5.5 before:-left-3 before:size-1.5 before:rotate-45 before:content-['']",
  'before:border-t-[1.5px] before:border-r-[1.5px] before:border-muted-foreground',
)
const AVATAR = cn(
  'size-5 rounded-sm border border-primary text-center',
  'text-[11px] leading-[18px] font-medium text-primary',
)

const breakdown = (stat: StageStat): string => {
  if (stat.stage === 'done') return 'last 7 days'
  const parts = STATES.filter((state) => stat.counts[state] > 0).map(
    (state) => `${stat.counts[state]} ${STATE_WORDS[state]}`,
  )
  return parts.length ? parts.join(' · ') : 'nothing here'
}

function Bar({ stat }: { stat: StageStat }) {
  const segments = STATES.filter((state) => stat.counts[state] > 0)
  const plain = stat.stage === 'done' || !segments.length
  return (
    <div aria-hidden className="flex h-1 gap-0.5">
      {plain && <i className="flex-1 bg-border" />}
      {!plain &&
        segments.map((state) => (
          <i key={state} className={STATE_BARS[state]} style={{ flexGrow: stat.counts[state] }} />
        ))}
    </div>
  )
}

function Workers({ workers }: { workers: Worker[] }) {
  return workers.map((worker) => (
    <span key={worker.key} title={worker.title} className={AVATAR}>
      <span aria-hidden>S</span>
      <span className="sr-only">{worker.title}</span>
    </span>
  ))
}

type Props = { stat: StageStat; workers: Worker[]; shipMedian: number | null }

export function StageHeader({ stat, workers, shipMedian }: Props) {
  const done = stat.stage === 'done'
  const median = done ? shipMedian : stat.medianSeconds
  return (
    <div className={cn(HEADER, stat.stage !== 'intake' && ARROW)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`stage-${stat.stage}`} className="label text-muted-foreground">{STAGE_NAMES[stat.stage]}</h2>
        <span className="title tabular-nums">{stat.total}</span>
      </div>
      <Bar stat={stat} />
      <p className="small text-muted-foreground">{breakdown(stat)}</p>
      <div className="flex min-h-5 items-center gap-1">
        <Workers workers={workers} />
        {median !== null && (
          <span className="small ml-auto text-muted-foreground">
            {done ? 'issue to shipped' : 'median'} <span className="mono">{duration(median)}</span>
          </span>
        )}
      </div>
    </div>
  )
}
