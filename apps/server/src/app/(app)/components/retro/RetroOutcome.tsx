'use client'
import { useState } from 'react'
import { undecidedCount } from '../../../../core/retro/changes'
import type { Decision, Outcome } from '../../../../core/retro/schema'
import { Button } from '../ui/button'
import { OutcomeDocuments } from './OutcomeDocuments'
import { OutcomeTickets } from './OutcomeTickets'

export type OutcomeResult = { outcome?: Outcome; error?: string }
export type OutcomeActions = {
  decideChange: (id: string, decision: Decision) => Promise<OutcomeResult>
  editChange: (id: string, add: string) => Promise<OutcomeResult>
  decideTicket: (id: string, decision: Decision) => Promise<OutcomeResult>
  apply: () => Promise<OutcomeResult>
}
type Props = {
  initial: Outcome
  applied: boolean
  isAdmin: boolean
  repos: { product: string; factory: string }
  day: string
  actions: OutcomeActions
}

export const blockReason = (outcome: Outcome, editing: number, isAdmin: boolean): string | null => {
  const left = undecidedCount(outcome)
  const kept = outcome.documents.some((d) => d.scope === 'factory' && d.changes.some((c) => c.decision === 'keep'))
  if (editing > 0) return 'The change you are editing is not decided yet. Keep or discard it, then Apply.'
  if (left > 0) return `${left} left to review. Keep or discard each, then Apply.`
  return kept && !isAdmin ? 'Only an Admin applies a change to the Factory document.' : null
}

export function RetroOutcome({ initial, applied, isAdmin, repos, day, actions }: Props) {
  const [outcome, setOutcome] = useState(initial)
  const [done, setDone] = useState(applied)
  const [editing, setEditing] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const take = (result: OutcomeResult): boolean => {
    setError(result.error ?? null)
    if (result.outcome) setOutcome(result.outcome)
    return !result.error
  }
  const reason = done ? null : blockReason(outcome, editing.length, isAdmin)
  const pressApply = async () => {
    setBusy(true)
    if (take(await actions.apply())) setDone(true)
    setBusy(false)
  }
  const mark = (id: string, on: boolean) => setEditing((now) => [...now.filter((e) => e !== id), ...(on ? [id] : [])])
  return (
    <div className="grid gap-6">
      <OutcomeDocuments outcome={outcome} done={done} actions={actions} take={take} mark={mark} />
      <OutcomeTickets outcome={outcome} done={done} repos={repos} day={day} actions={actions} take={take} />
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {error && (
          <span role="alert" className="small text-destructive">
            {error}
          </span>
        )}
        <span role="status" className="small text-muted-foreground">
          {done ? 'Applied.' : reason}
        </span>
        <Button
          type="button"
          className="ml-auto"
          disabled={done || busy || reason !== null}
          onClick={() => void pressApply()}
        >
          Apply
        </Button>
      </div>
    </div>
  )
}
