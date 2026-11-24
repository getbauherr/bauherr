import type { DiffLine } from '../../../../core/record/diff'
import { Badge } from '../ui/badge'

const TONE = { '+': 'bg-ok/10 text-ok', '-': 'bg-destructive/10 text-destructive', ' ': '' } as const

const WORDS = { '+': 'Added: ', '-': 'Removed: ', ' ': '' } as const

export type ShownLine = DiffLine & { inPlan?: boolean }

export function DiffBlock({ lines, label }: { lines: ShownLine[]; label: string }) {
  if (lines.length === 0) return null
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="mono min-w-0 overflow-x-auto rounded-md border border-border bg-secondary"
    >
      <ul className="m-0 grid w-max min-w-full list-none p-0">
        {lines.map((line, index) => (
          <li key={index} className={`flex items-baseline gap-2 px-3 py-0.5 whitespace-pre ${TONE[line.mark]}`}>
            <span aria-hidden="true" className="w-3 shrink-0">{line.mark}</span>
            <span className="sr-only">{WORDS[line.mark]}</span>
            <span>{line.text}</span>
            {line.inPlan === false && <Badge variant="warn" className="ml-auto shrink-0">not in plan</Badge>}
          </li>
        ))}
      </ul>
    </div>
  )
}
