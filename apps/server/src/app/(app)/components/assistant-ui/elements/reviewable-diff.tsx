'use client'
import type { ReactNode } from 'react'
import type { Decision } from '../../../../../core/retro/schema'
import { Button } from '../../ui/button'
import { Textarea } from '../../ui/textarea'
import { CodeDiff, type DiffLine } from './code-diff'

export type Hunk = {
  id: string
  title: string
  lines: DiffLine[]
  additions: number
  deletions: number
  decision: Decision
}

const LABEL = { discard: 'Discard', keep: 'Keep' } as const

type Editing = { draft: string; onDraft: (text: string) => void; onCancel: () => void; onDone: () => void }

export function ReviewableDiff({
  hunk,
  filename,
  editing,
  disabled,
  onDecide,
  onEdit,
}: {
  hunk: Hunk
  filename: string
  editing: Editing | null
  disabled: boolean
  onDecide: (decision: Decision) => void
  onEdit: () => void
}): ReactNode {
  return (
    <div data-slot="reviewable-diff" data-decision={hunk.decision} className="grid gap-2">
      <CodeDiff filename={filename} additions={hunk.additions} deletions={hunk.deletions} lines={hunk.lines} />
      {editing ? (
        <div className="grid gap-2">
          <label className="small grid gap-1">
            Edit the new line
            <Textarea value={editing.draft} onChange={(event) => editing.onDraft(event.target.value)} rows={2} />
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={editing.onCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={editing.onDone} disabled={editing.draft.trim() === ''}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Decide: ${hunk.title}`}>
          <Button type="button" variant="outline" disabled={disabled} onClick={onEdit}>
            Edit
          </Button>
          {(['discard', 'keep'] as const).map((decision) => (
            <Button
              key={decision}
              type="button"
              variant={hunk.decision === decision ? 'default' : 'outline'}
              aria-pressed={hunk.decision === decision}
              disabled={disabled}
              onClick={() => onDecide(decision)}
            >
              {LABEL[decision]}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
