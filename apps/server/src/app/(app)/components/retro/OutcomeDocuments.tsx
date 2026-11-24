'use client'
import type { Outcome } from '../../../../core/retro/schema'
import { OutcomeChange } from './OutcomeChange'
import type { OutcomeActions, OutcomeResult } from './RetroOutcome'

export const SCOPE = { factory: 'Factory', workspace: 'Workspace', product: 'Product' } as const

type Props = {
  outcome: Outcome
  done: boolean
  actions: OutcomeActions
  take: (result: OutcomeResult) => boolean
  mark: (id: string, on: boolean) => void
}

export function OutcomeDocuments({ outcome, done, actions, take, mark }: Props) {
  return outcome.documents.map((document) => {
    const kept = document.changes.filter((change) => change.decision === 'keep').length
    return (
      <section key={document.scope} aria-label={`${SCOPE[document.scope]} document`} className="grid gap-3">
        <h2 className="m-0 text-base font-semibold">
          {SCOPE[document.scope]}
          <span className="small ml-2 font-normal text-muted-foreground">
            {document.changes.length === 0 ? 'no change' : `${kept} of ${document.changes.length} kept`}
          </span>
        </h2>
        {document.changes.map((change) => (
          <OutcomeChange
            key={change.id}
            base={document.base}
            change={change}
            label={`${SCOPE[document.scope]} document`}
            disabled={done}
            onDecide={(id, decision) => void actions.decideChange(id, decision).then(take)}
            onSave={async (id, add) => take(await actions.editChange(id, add))}
            onEditing={mark}
          />
        ))}
      </section>
    )
  })
}
