'use client'
import { useState } from 'react'
import { applyChange } from '../../../../core/retro/changes'
import type { Decision, OutcomeChange as Change } from '../../../../core/retro/schema'
import { diffOf } from '../../lib/memory-diff'
import { ReviewableDiff } from '../assistant-ui/elements/reviewable-diff'

type Props = {
  base: string
  change: Change
  label: string
  disabled: boolean
  onDecide: (id: string, decision: Decision) => void
  onSave: (id: string, add: string) => Promise<boolean>
  onEditing: (id: string, editing: boolean) => void
}

export function OutcomeChange({ base, change, label, disabled, onDecide, onSave, onEditing }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const diff = diffOf(base, applyChange(base, change))
  const stop = () => {
    setDraft(null)
    onEditing(change.id, false)
  }
  return (
    <ReviewableDiff
      hunk={{ id: change.id, title: change.title, decision: change.decision, ...diff }}
      filename={`${label} · ${change.section}`}
      disabled={disabled}
      onDecide={(decision) => onDecide(change.id, decision)}
      onEdit={() => {
        setDraft(change.add)
        onEditing(change.id, true)
      }}
      editing={
        draft === null
          ? null
          : {
              draft,
              onDraft: setDraft,
              onCancel: stop,
              onDone: () => void onSave(change.id, draft).then((saved) => saved && stop()),
            }
      }
    />
  )
}
