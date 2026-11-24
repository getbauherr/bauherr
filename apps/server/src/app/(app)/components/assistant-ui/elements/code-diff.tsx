'use client'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export type DiffKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffKind
  text: string
}

const GUTTER: Record<DiffKind, string> = { context: '', added: '+', removed: '−' }

export function CodeDiff({
  filename,
  additions,
  deletions,
  lines,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  filename: string
  additions: number
  deletions: number
  lines: readonly DiffLine[]
}) {
  return (
    <div
      data-slot="code-diff"
      className={cn(
        'w-full overflow-hidden rounded-2xl border border-border/60 bg-background font-mono text-xs',
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-foreground/90">{filename}</span>
        <span className="font-mono text-[11px] tracking-tight tabular-nums">
          <span className="text-ok">+{additions}</span> <span className="text-destructive">−{deletions}</span>
        </span>
      </div>
      <div>
        <div>
          {lines.map((line, index) => (
            <div
              key={`${index}-${line.text}`}
              data-kind={line.kind}
              className={cn(
                'flex px-4 py-0.5 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]',
                line.kind === 'context' && 'text-muted-foreground',
                line.kind === 'added' && 'bg-ok/10 text-[color-mix(in_oklab,var(--ok),var(--ink)_40%)]',
                line.kind === 'removed' && 'bg-destructive/10 text-[color-mix(in_oklab,var(--danger),var(--ink)_40%)]',
              )}
            >
              <span aria-hidden className="w-4 shrink-0 select-none">{GUTTER[line.kind]}</span>
              <span className="min-w-0">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
