import Link from 'next/link'
import { LEVEL_LABEL } from '../../lib/retro'
import type { Proposal } from '../../../../core/retro/schema'
import { RecommendationCard } from '../assistant-ui/elements/recommendation-card'
import { AcceptButton } from './AcceptButton'

type Props = { retro: number; proposals: Proposal[]; agreed: string[]; titles: Map<number, string> }

export function ProposalCards({ retro, proposals, agreed, titles }: Props) {
  return (
    <div className="grid gap-3">
      {proposals.map((proposal) => (
        <RecommendationCard
          key={proposal.id}
          title={proposal.title}
          level={LEVEL_LABEL[proposal.level]}
          confidence={proposal.confidence}
          accepted={agreed.includes(proposal.id)}
          action={<AcceptButton retro={retro} id={proposal.id} accepted={agreed.includes(proposal.id)} />}
        >
          {proposal.cause && <p className="m-0">{proposal.cause}</p>}
          {proposal.evidence.length > 0 && (
            <p className="m-0">
              Evidence:{' '}
              {proposal.evidence.map((id, index) => (
                <span key={id}>
                  {index > 0 && ', '}
                  <Link href={`/tickets/${id}`} className="text-primary hover:underline">
                    {titles.get(id) ?? `Ticket ${id}`}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <p className="m-0">
            {proposal.change ? `Change: ${proposal.change.add}` : `Ticket: ${proposal.ticket?.title}`}
          </p>
        </RecommendationCard>
      ))}
    </div>
  )
}
