import type { TicketView } from '../../../../core/views/ticket'
import { RESULT_ACTIONS } from '../../lib/decision-actions'
import { DecisionForm } from './DecisionForm'
import { ResultBody } from './ResultBody'
import { Card } from './Section'

const ACCEPT = 'Accept the Result to finish the ticket.'
const NOT_ALLOWED = 'A Bauherr of this Workspace decides on the Result.'

type Props = { view: TicketView; seq: number; proof: string | undefined; may: boolean }

export function ResultCard({ view, seq, proof, may }: Props) {
  return (
    <Card bare>
      <DecisionForm
        recordId={view.recordId}
        ask="result"
        seq={seq}
        sentence={may ? ACCEPT : NOT_ALLOWED}
        actions={may ? RESULT_ACTIONS : []}
      >
        <div className="grid gap-5 p-6">
          <ResultBody view={view} tab="now" proof={proof} />
        </div>
      </DecisionForm>
    </Card>
  )
}
