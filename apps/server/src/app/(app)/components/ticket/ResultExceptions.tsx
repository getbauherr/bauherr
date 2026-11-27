import type { TicketView } from '../../../../core/views/ticket'
import { RefText } from '../RefText'
import { Section } from './Section'

export function ResultExceptions({ view }: { view: TicketView }) {
  const { record, acceptedUnmet } = view
  const { repo } = record.source
  const unmet = record.criteria.filter((criterion) => acceptedUnmet.includes(criterion.id))
  if (record.dropped.length === 0 && unmet.length === 0) return null
  return (
    <>
      {record.dropped.length > 0 && (
        <Section title="Dropped by you">
          <ul className="m-0 grid gap-1 pl-5">
            {record.dropped.map(({ id, text, note }) => (
              <li key={id}>
                <span className="mono">{id}</span> <RefText text={text} repo={repo} />
                {note !== '' && <span className="small text-muted-foreground">: {note}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {unmet.length > 0 && (
        <Section title="Not met, accepted by you">
          <ul className="m-0 grid gap-1 pl-5">
            {unmet.map(({ id, text }) => (
              <li key={id}>
                <span className="mono">{id}</span> <RefText text={text} repo={repo} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
