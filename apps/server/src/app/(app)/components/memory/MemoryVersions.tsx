'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { diffOf } from '../../lib/memory-diff'
import { CodeDiff } from '../assistant-ui/elements/code-diff'

export type VersionRow = { id: number; number: number; body: string; label: string; date: string }

export function MemoryVersions({ versions }: { versions: VersionRow[] }) {
  const [open, setOpen] = useState<number | null>(versions[0]?.id ?? null)
  if (versions.length === 0) return <p className="small text-muted-foreground">No versions yet.</p>
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {versions.map((version, index) => {
        const shown = open === version.id
        const before = versions[index + 1]
        const diff = diffOf(before?.body ?? '', version.body)
        return (
          <li key={version.id} className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span>
                v{version.number} · {version.date} · {version.label}
              </span>
              <button
                type="button"
                aria-expanded={shown}
                aria-label={`${shown ? 'hide diff' : 'diff'} of v${version.number}`}
                onClick={() => setOpen(shown ? null : version.id)}
                className={cn(
                  'small rounded-sm text-primary outline-none hover:underline',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {shown ? 'hide diff' : 'diff'}
              </button>
            </div>
            {shown && (
              <CodeDiff
                filename={before ? `v${before.number} → v${version.number}` : `v${version.number}`}
                additions={diff.additions}
                deletions={diff.deletions}
                lines={diff.lines}
                className="small"
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
