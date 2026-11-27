'use client'
import { useState } from 'react'
import { diffOf } from '../../lib/memory-diff'
import { CodeDiff } from '../assistant-ui/elements/code-diff'
import { Button } from '../ui/button'

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
              <Button
                type="button"
                variant="link"
                size="xs"
                aria-expanded={shown}
                aria-label={`${shown ? 'hide diff' : 'diff'} of v${version.number}`}
                onClick={() => setOpen(shown ? null : version.id)}
                className="small h-auto rounded-sm p-0 font-normal"
              >
                {shown ? 'hide diff' : 'diff'}
              </Button>
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
