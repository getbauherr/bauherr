import type { TicketView } from '../../../../core/views/ticket'
import { ActivityList } from './ActivityList'
import { BriefSheet } from './BriefSheet'
import { AnsweredDecisions } from './Decisions'
import { ResultBody } from './ResultBody'
import { Card, Section } from './Section'
import { RefText } from '../RefText'

export function BriefTab({ view }: { view: TicketView }) {
  const { record } = view
  if (record.goal === '') return <Card><p>No Brief yet. The agent writes it after Intake.</p></Card>
  return (
    <Card>
      <BriefSheet record={record} mockups={view.mockups} missing={view.noMockup} />
      {record.plan.steps.length > 0 && (
        <Section title="Plan">
          <ol className="m-0 grid gap-1 pl-5">
            {record.plan.steps.map((step) => <li key={step}><RefText text={step} repo={record.source.repo} /></li>)}
          </ol>
        </Section>
      )}
      <AnsweredDecisions decisions={record.decisions} repo={record.source.repo} />
    </Card>
  )
}

export function ResultTab({ view, proof }: { view: TicketView; proof: string | undefined }) {
  if (view.record.result === null) {
    return <Card><p>No Result yet. It appears when the verifier has finished.</p></Card>
  }
  return <Card><ResultBody view={view} tab="result" proof={proof} /></Card>
}

export function ActivityTab({ view }: { view: TicketView }) {
  return <ActivityList events={view.events} repo={view.record.source.repo} />
}
