'use client'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { useContext } from 'react'
import { INTENT_TOOL } from '../../lib/inbox-steer'
import { PendingContext } from './DecisionToolUI'
import { Receipt } from './Receipt'

type Args = { key: string; recordId: number; number: number }

function Intent({ args }: { args: Args }) {
  const pending = useContext(PendingContext)
  const staged = pending?.staged[args.key]
  if (!pending || !staged) return null
  return <Receipt staged={staged} recordId={args.recordId} number={args.number} onUndo={() => pending.undo(args.key)} />
}

export const IntentToolUI = makeAssistantToolUI<Args, string>({
  toolName: INTENT_TOOL,
  render: ({ args }) => <Intent args={args} />,
})
