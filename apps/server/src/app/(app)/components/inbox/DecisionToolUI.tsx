'use client'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { createContext, useContext, type ReactNode } from 'react'
import type { DecisionModel } from '../../lib/inbox-decision'
import { DECISION_TOOL } from '../../lib/inbox-thread'
import { DecisionCard } from './DecisionCard'
import type { Pending } from './use-pending-decisions'

export const PendingContext = createContext<Pending | null>(null)

export const ProposalDoneContext = createContext<() => void>(() => undefined)

type ProviderProps = { pending: Pending; onProposalDone: () => void; children: ReactNode }

export function PendingProvider({ pending, onProposalDone, children }: ProviderProps) {
  return (
    <PendingContext.Provider value={pending}>
      <ProposalDoneContext.Provider value={onProposalDone}>{children}</ProposalDoneContext.Provider>
    </PendingContext.Provider>
  )
}

function Rendered({ model }: { model: DecisionModel }) {
  const pending = useContext(PendingContext)
  return pending ? <DecisionCard model={model} pending={pending} /> : null
}

export const DecisionToolUI = makeAssistantToolUI<DecisionModel, string>({
  toolName: DECISION_TOOL,
  render: ({ args }) => <Rendered model={args} />,
})
