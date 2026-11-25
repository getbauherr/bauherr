'use client'
import { useEffect, useState, useTransition } from 'react'
import {
  addTicketRelation,
  removeTicketRelation,
  searchRelationCandidates,
} from '../../(shell)/tickets/relation-actions'
import type { Candidate, RelatedTicket, RelationGroup, TicketRelations } from '../../../../core/views/ticket-relations'
import { TicketRefPopover } from '../TicketRefPopover'
import { Button } from '../ui/button'
import { Command, CommandInput, CommandItem, CommandList } from '../ui/command'
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

function useSearch(recordId: number, query: string): Candidate[] {
  const [results, setResults] = useState<Candidate[]>([])
  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      void searchRelationCandidates({ recordId, query }).then((found) => {
        if (!stale) setResults(found)
      })
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [recordId, query])
  return results
}

function TicketPicker({
  recordId,
  chosen,
  choose,
}: {
  recordId: number
  chosen: Candidate | null
  choose: (ticket: Candidate | null) => void
}) {
  const [query, setQuery] = useState('')
  const results = useSearch(recordId, query)
  if (chosen) {
    return (
      <button
        type="button"
        aria-label="Ticket"
        className="small truncate rounded-md border px-3 py-2 text-left"
        onClick={() => choose(null)}
      >
        #{chosen.number} {chosen.title} ✕
      </button>
    )
  }
  return (
    <Command shouldFilter={false} className="min-w-0 rounded-md border">
      <CommandInput
        aria-label="Search tickets"
        placeholder="Search by number or title"
        value={query}
        onValueChange={setQuery}
      />
      {results.length > 0 ? (
        <CommandList className="max-h-48">
          {results.map((candidate) => (
            <CommandItem key={candidate.itemId} value={String(candidate.itemId)} onSelect={() => choose(candidate)}>
              #{candidate.number} {candidate.title}
            </CommandItem>
          ))}
        </CommandList>
      ) : (
        query && <p className="small m-0 p-2 text-muted-foreground">No ticket found</p>
      )}
    </Command>
  )
}

function AddRelation({ recordId, add, disabled }: { recordId: number; add: Change; disabled: boolean }) {
  const [group, setGroup] = useState<RelationGroup>('blocked-by')
  const [chosen, setChosen] = useState<Candidate | null>(null)
  return (
    <form
      className="grid min-w-0 gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (chosen) add(group, chosen.itemId)
        setChosen(null)
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
      <TicketPicker recordId={recordId} chosen={chosen} choose={setChosen} />
      <Button type="submit" variant="outline" disabled={disabled || !chosen}>
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
      {may && <AddRelation recordId={recordId} add={run(addTicketRelation)} disabled={pending} />}
      {error && (
        <p role="alert" className="small m-0 text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
