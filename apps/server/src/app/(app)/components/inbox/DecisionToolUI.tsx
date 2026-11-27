'use client'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { createContext, useContext, type ReactNode } from 'react'
import type { DecisionModel } from '../../lib/inbox-decision'
import { DECISION_TOOL } from '../../lib/inbox-thread'
import { DecisionCard } from './DecisionCard'
import type { Pending } from './use-pending-decisions'

export const PendingContext = createContext<Pending | null>(null)

export function PendingProvider({ pending, children }: { pending: Pending; children: ReactNode }) {
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
}

function Rendered({ model }: { model: DecisionModel }) {
  const pending = useContext(PendingContext)
  return pending ? <DecisionCard model={model} pending={pending} /> : null
}

export const DecisionToolUI = makeAssistantToolUI<DecisionModel, string>({
  toolName: DECISION_TOOL,
  render: ({ args }) => <Rendered model={args} />,
})
