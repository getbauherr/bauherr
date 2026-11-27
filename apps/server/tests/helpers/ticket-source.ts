import { emptyRecord, type Criterion } from '../../src/core/record/schema'
import type { StoredCard } from '../../src/core/record/store'
import type { ThreadSource } from '../../src/app/(app)/lib/inbox-thread'
import type { TicketRefs } from '../../src/core/views/refs'

export const source = {
  forge: 'github' as const,
  repo: 'acme/app',
  number: 928,
  reporter: 'ann',
  external: false,
  backlog: false,
}

export const cardOf = (
  card: StoredCard['card'],
  reason: string,
  options: string[] = [],
  seq = 1,
): StoredCard => ({ card, reason, options, seq })

export const criterion = (id: string, status: Criterion['status']): Criterion => ({
  id,
  text: `Criterion ${id}`,
  verify: { kind: 'test', how: 'a test' },
  status,
  proof: [],
})

export const sourceOf = (card: StoredCard | null, extra: Partial<ThreadSource> = {}): ThreadSource => ({
  recordId: 126,
  number: 928,
  title: 'Show where a version is live',
  status: card ? 'brief-needs-approval' : 'building',
  closedAs: null,
  card,
  record: emptyRecord(source, 'change'),
  deploy: null,
  events: [],
  comments: [],
  ...extra,
})

export const refsOf = (...tickets: { recordId: number; number: number }[]): TicketRefs => {
  const refs: TicketRefs = { byId: new Map(), byMention: new Map() }
  for (const { recordId, number } of tickets) {
    const ref = { recordId, number, title: `T${number}`, stage: 'build' as const }
    refs.byId.set(recordId, ref)
    refs.byMention.set(`acme/app#${number}`, ref)
  }
  return refs
}

export const need = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('Expected a value')
  return value
}
