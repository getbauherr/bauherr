import Link from 'next/link'
import type { TicketView } from '../../../../core/views/ticket'
import { BRIEF_ACTIONS } from '../../lib/decision-actions'
import { REASON_WORDS } from '../../lib/ticket-words'
import { BriefSheet } from './BriefSheet'
import { DecisionForm } from './DecisionForm'
import { OpenDecisions } from './Decisions'
import { Card } from './Section'

type Props = { view: TicketView; seq: number; reason: string; may: boolean }

export function BriefCard({ view, seq, reason, may }: Props) {
  const why = reason in REASON_WORDS ? REASON_WORDS[reason as keyof typeof REASON_WORDS] : reason
  return (
    <Card bare>
      <DecisionForm
        recordId={view.recordId}
        ask="brief"
        seq={seq}
        sentence={may ? 'Approve the Brief to start the build.' : 'A Bauherr of this Workspace decides on the Brief.'}
        actions={may ? BRIEF_ACTIONS : []}
      >
        <div className="grid gap-5 p-6">
          {view.fromReadiness !== null && (
            <p className="m-0">
              From the readiness check:{' '}
              <Link href={`/settings/products/${view.fromReadiness}`} className="text-primary hover:underline">
                {view.title}
              </Link>
            </p>
          )}
          <BriefSheet record={view.record} mockups={view.mockups} missing={view.noMockup} reason={why} />
          <OpenDecisions decisions={view.record.decisions} repo={view.record.source.repo} />
        </div>
      </DecisionForm>
    </Card>
  )
}
