import Link from 'next/link'
import type { Stage } from '../lib/needs-you'
import { board, DEFAULT, title } from '../../../lib/workflow'
import { cn } from '@/lib/utils'

export function StagePipeline({ current, reached, selected }: { current: Stage; reached: Stage[]; selected?: Stage }) {
  const stages = board(DEFAULT())
  const at = stages.indexOf(current === 'parent' ? 'plan' : current)
  return (
    <ol className="label m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Stage">
      {stages.map((s, i) => {
        const cls = cn('block rounded-sm border border-border px-3 py-1 text-muted-foreground opacity-65', i < at && 'border-transparent opacity-100', i === at && 'border-primary bg-accent text-primary opacity-100', s === selected && 'underline underline-offset-4')
        return (
          <li key={s} aria-current={i === at ? 'step' : undefined}>
            {reached.includes(s) ? (
              <Link className={cn(cls, 'opacity-100 hover:bg-accent')} href={s === selected ? '?' : `?stage=${s}`} scroll={false} aria-expanded={s === selected}>{title(DEFAULT(), s)}</Link>
            ) : (
              <span className={cls} aria-disabled="true" title="Not reached yet">{title(DEFAULT(), s)}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
