import { STAGES, type Stage, stageLabel } from '../lib/needs-you'

export function StagePipeline({ current }: { current: Stage }) {
  const at = STAGES.indexOf(current)
  return (
    <ol className="pipe label" aria-label="Stage">
      {STAGES.map((s, i) => (
        <li key={s} data-s={i < at ? 'done' : i === at ? 'current' : 'later'} aria-current={i === at ? 'step' : undefined}>{stageLabel(s)}</li>
      ))}
    </ol>
  )
}
