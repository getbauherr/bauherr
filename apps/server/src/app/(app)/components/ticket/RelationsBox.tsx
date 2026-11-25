'use client'
import { useState, useTransition } from 'react'
import { addTicketRelation, removeTicketRelation } from '../../(shell)/tickets/relation-actions'
import type { RelatedTicket, RelationGroup, TicketRelations } from '../../../../core/views/ticket-relations'
import { TicketRefPopover } from '../TicketRefPopover'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'
import { CARD } from './Section'

const GROUPS: [RelationGroup, string][] = [
  ['part-of', 'Part of'],
  ['blocked-by', 'Blocked by'],
  ['blocks', 'Blocks'],
  ['relates-to', 'Relates to'],
]

type Change = (group: RelationGroup, other: number) => void

function Row({ ticket, group, label, remove, disabled }: Props & { ticket: RelatedTicket; group: RelationGroup }) {
  return (
    <li className="small flex items-start justify-between gap-2">
      <span className="min-w-0">
        {ticket.recordId === null ? (
          <span className="mono">#{ticket.number}</span>
        ) : (
          <TicketRefPopover
            ticket={{ ...ticket, recordId: ticket.recordId }}
            label={`#${ticket.number}`}
            className="mono"
          />
        )}{' '}
        {ticket.title} <span className="text-muted-foreground">{ticket.stage}</span>
      </span>
      {remove && (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Remove ${label} #${ticket.number}`}
          onClick={() => remove(group, ticket.itemId)}
          className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
        >
          ✕
        </button>
      )}
    </li>
  )
}

type Props = { label: string; remove: Change | null; disabled: boolean }

function AddRelation({ relations, add, disabled }: { relations: TicketRelations; add: Change; disabled: boolean }) {
  const [group, setGroup] = useState<RelationGroup>('blocked-by')
  const [other, setOther] = useState('')
  return (
    <form
      className="grid min-w-0 gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (other) add(group, Number(other))
        setOther('')
      }}
    >
      <NativeSelect
        aria-label="Relation type"
        className="w-full min-w-0"
        value={group}
        onChange={(e) => setGroup(e.target.value as RelationGroup)}
      >
        {GROUPS.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Ticket"
        className="w-full min-w-0"
        value={other}
        onChange={(e) => setOther(e.target.value)}
      >
        <option value="">Choose a ticket</option>
        {relations.candidates.map((candidate) => (
          <option key={candidate.itemId} value={candidate.itemId}>
            #{candidate.number} {candidate.title}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" disabled={disabled || !other}>
        + Add a relation
      </Button>
    </form>
  )
}

type BoxProps = { recordId: number; relations: TicketRelations; may: boolean }

export function RelationsBox({ recordId, relations, may }: BoxProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const run = (act: typeof addTicketRelation) => (group: RelationGroup, other: number) =>
    start(async () => setError((await act({ recordId, group, other })).error ?? null))
  return (
    <section aria-label="Relations" className={`${CARD} grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-4`}>
      <h2 className="label m-0 text-muted-foreground">Relations</h2>
      {GROUPS.map(([key, label]) => {
        const tickets = relations.groups[key]
        return tickets.length === 0 ? null : (
          <div key={key} className="grid gap-1">
            <h3 className="small m-0 font-medium">{label}</h3>
            <ul className="m-0 grid list-none gap-1 p-0">
              {tickets.map((ticket) => (
                <Row
                  key={ticket.itemId}
                  ticket={ticket}
                  group={key}
                  label={label}
                  remove={may ? run(removeTicketRelation) : null}
                  disabled={pending}
                />
              ))}
            </ul>
          </div>
        )
      })}
      {may && <AddRelation relations={relations} add={run(addTicketRelation)} disabled={pending} />}
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
