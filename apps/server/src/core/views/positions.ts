import type { TicketRecord } from '../record/schema'
import type { StoredCard, StoredEvent } from '../record/store'
import type { RunView } from './ticket-parts'

export const FINDING_CAP = 300
export const HANDOFF_CAP = 600

export type Position = { text: string; cut: boolean }

export type Positions = {
  rounds: number
  verifier: Position | null
  builder: Position | null
  handoffRunId: number | null
}

const capped = (text: string, cap: number): Position =>
  text.length > cap ? { text: `${text.slice(0, cap - 1).trimEnd()}…`, cut: true } : { text, cut: false }

type Source = { card: StoredCard | null; record: TicketRecord; runs: RunView[]; events: StoredEvent[] }

export const positionsOf = ({ card, record, runs, events }: Source): Positions | null => {
  if (card?.card !== 'question' || card.reason !== 'verify-rounds') return null
  const finding = record.findings.findLast((f) => f.status === 'open' || f.status === 'fixing')
  const ended = (status: string) => status === 'submitted' || status === 'failed'
  const handoffRun = runs.findLast((run) => run.stage === 'build' && ended(run.status))
  return {
    rounds: events.filter((event) => event.type === 'verify.changes').length,
    verifier: finding ? capped(finding.text, FINDING_CAP) : null,
    builder: record.handoff === '' ? null : capped(record.handoff, HANDOFF_CAP),
    handoffRunId: handoffRun?.id ?? null,
  }
}
