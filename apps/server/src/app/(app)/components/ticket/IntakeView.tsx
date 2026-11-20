import { CAPS } from '../../../../core/caps'
import { REQUIRED_FIELDS } from '../../../../core/intake/facts'
import type { TicketView } from '../../../../core/views/ticket'
import { Card, Facts, Section } from './Section'

const TYPE_WORDS = { bug: 'Bug', feature: 'Feature', change: 'Change', chore: 'Chore' } as const

const fieldsOf = (view: TicketView): string => {
  const required = REQUIRED_FIELDS[view.record.type]
  if (required.length === 0) return 'None required for this type.'
  const missing = view.facts?.missing ?? []
  return required.map((field) => `${field} ${missing.includes(field) ? 'missing' : 'given'}`).join(' · ')
}

const duplicatesOf = (view: TicketView): string => {
  const similar = view.facts?.similar ?? []
  if (similar.length === 0) return 'None.'
  return similar.map((item) => `#${item.number} ${item.title} (${item.state})`).join('; ')
}

const sentenceOf = (view: TicketView): string =>
  view.waitingOn === 'reporter'
    ? 'Waiting for the reporter. Nothing to do.'
    : 'The factory is checking this issue. Nothing to do.'

export function IntakeView({ view }: { view: TicketView }) {
  const { source } = view.record
  const round = view.facts?.rounds.at(-1)
  return (
    <Card bare>
      <div className="grid gap-5 p-6">
        <Section title="Intake check">
          <Facts
            rows={[
              ['Type', TYPE_WORDS[view.record.type]],
              ['Author', `${source.reporter}${source.external ? ', outside author' : ''}`],
              ['Required fields', fieldsOf(view)],
              ['Duplicates', duplicatesOf(view)],
            ]}
          />
        </Section>
        {round && (
          <Section title={`Question sent to the reporter, round ${round.round} of ${CAPS.reporterRounds}`}>
            <pre className="mono m-0 whitespace-pre-wrap rounded-md bg-secondary p-3">{round.questions}</pre>
            {round.replies.map((reply) => (
              <pre key={reply} className="mono m-0 whitespace-pre-wrap rounded-md bg-secondary p-3">{reply}</pre>
            ))}
          </Section>
        )}
      </div>
      <div className="rounded-b-md border-t border-border px-4 py-3">
        <p>{sentenceOf(view)}</p>
      </div>
    </Card>
  )
}
