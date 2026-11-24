import Link from 'next/link'
import type { Position, Positions as PositionsView } from '../../../../core/views/positions'
import type { TicketView } from '../../../../core/views/ticket'
import { Section } from './Section'

type SideProps = { label: string; position: Position | null; empty: string; href: string | null; more: string }

function Side({ label, position, empty, href, more }: SideProps) {
  return (
    <div className="grid content-start gap-0.5 border-l-2 border-border pl-3">
      <h3 className="label m-0 text-muted-foreground">{label}</h3>
      <p className="small m-0 whitespace-pre-wrap break-words leading-snug text-foreground">
        {position ? position.text : empty}
      </p>
      {position?.cut && href && (
        <Link href={href} className="small text-primary hover:underline">
          {more}
        </Link>
      )}
    </div>
  )
}

export function Positions({ view, positions }: { view: TicketView; positions: PositionsView }) {
  const handoffHref = positions.handoffRunId === null ? null : `/runs/${positions.handoffRunId}`
  const rounds = `${positions.rounds} review round${positions.rounds === 1 ? '' : 's'}`
  return (
    <Section title={`Where they differ after ${rounds}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Side
          label="Verifier: last open finding"
          position={positions.verifier}
          empty="No finding is open."
          href={`/tickets/${view.recordId}#findings`}
          more="Read the full finding"
        />
        <Side
          label="Builder: last handoff"
          position={positions.builder}
          empty="The builder wrote no handoff."
          href={handoffHref}
          more="Read the full handoff"
        />
      </div>
    </Section>
  )
}
