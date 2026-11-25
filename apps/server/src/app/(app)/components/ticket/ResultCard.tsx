import type { TicketView } from '../../../../core/views/ticket'
import { RESULT_ACTIONS } from '../../lib/decision-actions'
import { CommentList } from '../request/CommentList'
import { RequestComposer } from '../request/RequestComposer'
import { DecisionForm } from './DecisionForm'
import { ResultBody } from './ResultBody'
import { Card } from './Section'

const ACCEPT = 'Accept the Result to finish the ticket.'
const ACCEPT_ADOPTED = 'Accept the Result to merge the pull request and finish the ticket.'
const NOT_ALLOWED = 'A Bauherr of this Workspace decides on the Result.'

type Props = { view: TicketView; seq: number; proof: string | undefined; may: boolean }

export function ResultCard({ view, seq, proof, may }: Props) {
  const accepting = view.adopted && view.pullRequest?.state !== 'merged'
  return (
    <>
      <Card bare>
        <DecisionForm
          recordId={view.recordId}
          ask="result"
          seq={seq}
          sentence={may ? (accepting ? ACCEPT_ADOPTED : ACCEPT) : NOT_ALLOWED}
          actions={may ? RESULT_ACTIONS : []}
        >
          <div className="grid gap-5 p-6">
            <ResultBody view={view} tab="now" proof={proof} />
            <CommentList comments={view.comments} />
          </div>
        </DecisionForm>
      </Card>
      <RequestComposer recordId={view.recordId} />
    </>
  )
}
