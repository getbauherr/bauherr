import { Fragment } from 'react'
import { resolveMention, type TicketRefs } from '../../../core/views/refs'
import { STAGE_NAMES } from '../lib/factory'
import { TicketRefPopover } from './TicketRefPopover'

export const TITLE_LIMIT = 60

export const clip = (title: string): string =>
  title.length > TITLE_LIMIT ? `${title.slice(0, TITLE_LIMIT).trimEnd()}…` : title

type Props = { text: string; repo: string; refs: TicketRefs }

export function RefTextView({ text, repo, refs }: Props) {
  return text.split(/((?<![\w/&])[#!]\d+)/).map((part, index) => {
    const sigil = part.startsWith('!') ? '!' : '#'
    const ticket = index % 2 === 1 ? resolveMention(refs, repo, Number(part.slice(1)), sigil) : null
    if (!ticket) return <Fragment key={index}>{part}</Fragment>
    return (
      <TicketRefPopover
        key={index}
        ticket={{ ...ticket, stage: STAGE_NAMES[ticket.stage] }}
        label={`${part} ${clip(ticket.title)}`}
      />
    )
  })
}
