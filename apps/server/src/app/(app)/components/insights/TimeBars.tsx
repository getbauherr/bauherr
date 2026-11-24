import type { StageTime, TimeSummary } from '../../../../core/views/insights'
import { PARTS } from '../../../../core/views/time-split'
import { STAGE_NAMES } from '../../lib/factory'
import { PART_CLASSES, PART_WORDS, span } from '../../lib/insights'

const textOf = (row: StageTime): string =>
  `${STAGE_NAMES[row.stage]}: ${span(row.seconds)}. ` +
  `${PARTS.map((part) => `${PART_WORDS[part]} ${span(row.split[part])}`).join(', ')}.`

const ROW = 'small grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-3 sm:grid-cols-[120px_minmax(0,1fr)_72px]'

function Bar({ row, scale }: { row: StageTime; scale: number }) {
  return (
    <li className={ROW}>
      <span>{STAGE_NAMES[row.stage]}</span>
      <span role="img" aria-label={textOf(row)} className="flex h-3.5 overflow-hidden rounded-xs bg-secondary">
        {PARTS.map((part) => (
          <span
            key={part}
            className={`block h-full ${PART_CLASSES[part]}`}
            style={{ width: `${(row.split[part] / scale) * 100}%` }}
          />
        ))}
      </span>
      <span className="mono text-right">{span(row.seconds)}</span>
    </li>
  )
}

export function TimeBars({ time }: { time: TimeSummary }) {
  const scale = Math.max(...time.stages.map((row) => row.seconds), 1)
  return (
    <section aria-labelledby="where-time" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 id="where-time" className="label text-muted-foreground">Where the time goes</h2>
      {time.sentence && <p className="small">{time.sentence}</p>}
      <ul aria-label="Colors" className="small m-0 flex list-none flex-wrap gap-4 p-0 text-muted-foreground">
        {PARTS.map((part) => (
          <li key={part} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block size-2.5 rounded-xs ${PART_CLASSES[part]}`} />
            {PART_WORDS[part]}
          </li>
        ))}
      </ul>
      <ul aria-label="Time per stage" className="m-0 grid list-none gap-1.5 p-0">
        {time.stages.map((row) => <Bar key={row.stage} row={row} scale={scale} />)}
      </ul>
      <p className="small text-muted-foreground">
        Median per stay in the stage, for tickets done in the range. A stage entered twice counts twice. Time not
        in a color is waiting on someone else.
      </p>
    </section>
  )
}
