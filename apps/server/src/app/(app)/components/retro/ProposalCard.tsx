'use client'

import { makeAssistantToolUI } from '@assistant-ui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { acceptProposalAction } from '../../(shell)/memory/retro/actions'
import { LEVEL_LABEL } from '../../lib/retro'
import { RecommendationCard } from '../assistant-ui/elements/recommendation-card'
import { withToolStates } from '../conversation/tool-ui'
import { PROPOSE_TOOL, type ProposeArgs } from './retro-adapter'

const LEVEL_WORD = (args: ProposeArgs): string => LEVEL_LABEL[args.proposal.level]

function Evidence({ ids, titles }: { ids: number[]; titles: Record<number, string> }) {
  if (ids.length === 0) return null
  return (
    <span className="block">
      Evidence:{' '}
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 && ', '}
          <Link href={`/tickets/${id}`} className="text-primary hover:underline">
            {titles[id] ?? `Ticket ${id}`}
          </Link>
        </span>
      ))}
    </span>
  )
}

function ProposalCard({ args }: { args: ProposeArgs }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { proposal } = args
  const accept = () =>
    start(async () => {
      const result = await acceptProposalAction(args.retro, proposal.id)
      setError(result.error ?? null)
      router.refresh()
    })
  return (
    <div className="grid gap-2" aria-busy={pending}>
      <RecommendationCard
        state={args.accepted ? 'accepted' : 'idle'}
        question={`${LEVEL_WORD(args)}: ${proposal.title}`}
        confidenceLabel={`${proposal.confidence} confidence`}
        acceptedLabel="Accepted: goes into the outcome"
        {...(pending ? {} : { onAccept: accept })}
      >
        {proposal.cause && <span className="block">{proposal.cause}</span>}
        <Evidence ids={proposal.evidence} titles={args.titles} />
        <span className="block">
          {proposal.change ? `Change: ${proposal.change.add}` : `Ticket: ${proposal.ticket?.title}`}
        </span>
      </RecommendationCard>
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export const ProposeToolUI = makeAssistantToolUI<ProposeArgs, string>({
  toolName: PROPOSE_TOOL,
  render: withToolStates((props) => <ProposalCard args={props.args} />),
})
