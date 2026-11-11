import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { SetupStepId, SetupSteps } from '../../lib/setup'
import { StatusWord } from '../SettingsParts'

/** The five steps in order with their state; done steps and the first undone one are links (`?step=`), later ones are plain text. */
export function SetupRail({ steps, shown }: { steps: SetupSteps; shown?: SetupStepId }) {
  const first = steps.findIndex((s) => !s.done)
  return (
    <ol aria-label="Setup" className="m-0 grid list-none grid-cols-5 gap-2 p-0 max-md:grid-cols-1">
      {steps.map((s, i) => {
        const open = first < 0 || i <= first
        const body = (
          <>
            <span className="flex items-center justify-between gap-2">
              <span className="mono text-muted-foreground">{i + 1}</span>
              <StatusWord tone={s.done ? 'ok' : 'muted'}>{s.done ? 'Done' : s.required ? 'To do' : 'Optional'}</StatusWord>
            </span>
            <span>{s.label}</span>
          </>
        )
        const cls = cn('flex h-full flex-col gap-2 rounded-md border border-border bg-card px-3 py-2', s.id === shown && 'bg-accent outline-2 -outline-offset-1 outline-primary')
        return (
          <li key={s.id}>
            {open ? <Link href={`/setup?step=${s.id}`} aria-current={s.id === shown ? 'step' : undefined} className={cls}>{body}</Link> : <span className={cn(cls, 'text-muted-foreground')}>{body}</span>}
          </li>
        )
      })}
    </ol>
  )
}
