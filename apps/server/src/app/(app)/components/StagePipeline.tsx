import { STAGES, type Stage, stageLabel } from '../lib/needs-you'
import { cn } from '@/lib/utils'

export function StagePipeline({ current }: { current: Stage }) {
  const at = STAGES.indexOf(current === 'parent' ? 'plan' : current)
  return (
    <ol className="label m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Stage">
      {STAGES.map((s, i) => (
        <li
          key={s}
          className={cn('rounded-sm border border-border px-3 py-1 text-muted-foreground opacity-65', i < at && 'border-transparent opacity-100', i === at && 'border-primary bg-accent text-primary opacity-100')}
          aria-current={i === at ? 'step' : undefined}
        >
          {stageLabel(s)}
        </li>
      ))}
    </ol>
  )
}
