import type { Actor, EventType, Stage } from '../events'
import type { StoredEvent } from '../record/store'
import { OWN_ANSWER } from '../decisions'
import { labelOf } from './labels'
import { timelineOf, type TimelineKind, type TimelineTone } from './timeline'

export type EventView = {
  id: number
  type: EventType
  actor: Actor
  at: string
  label: string
  kind: TimelineKind
  tone: TimelineTone
  state: string | null
  enters: Stage | null
}

const ANSWER_MARK = '\nAnswer: '

const withComment = (previous: StoredEvent, label: string, note: string): string => {
  let comment = note
  if (previous.type === 'question.answered' && note.startsWith('Question: ') && note.includes(ANSWER_MARK)) {
    const answer = note.slice(note.indexOf(ANSWER_MARK) + ANSWER_MARK.length)
    const { option } = previous.data
    if (option === OWN_ANSWER) return `The owner answered in their own words: ${answer}`
    comment = answer.slice(option.length + 1)
  }
  return comment === '' ? label : `${label}. Comment: ${comment}`
}

const approvedAfter = (approved: boolean, event: StoredEvent): boolean => {
  if (event.type === 'brief.approved') return true
  return event.type === 'brief.submitted' || event.type === 'brief.changes-requested' ? false : approved
}

export const activityOf = (events: StoredEvent[]): EventView[] => {
  const views: EventView[] = []
  let previous: StoredEvent | null = null
  let approved = false
  for (const event of events) {
    const last = views.at(-1)
    if (event.type === 'owner.note' && previous && last) {
      last.label = withComment(previous, last.label, event.data.note)
      continue
    }
    const sentBack = event.type === 'brief.changes-requested' && approved
    const label = sentBack ? `Sent back to Brief: ${event.data.note}` : labelOf(event)
    views.push({ id: event.id, type: event.type, actor: event.actor, at: event.createdAt, label, ...timelineOf(event) })
    previous = event
    approved = approvedAfter(approved, event)
  }
  return views
}
