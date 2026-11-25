import type { Payload } from 'payload'
import { evaluate, type CheckId, type Finding } from './checks'
import { releaseBlocked } from './release-checks'
import { loadHeldUp, type HeldUp } from './held-up'
import { loadFacts, type FactsFilter } from './load'
import { openedTickets, openTicketOf, type OpenTicket } from './tickets'

export type ReadinessItem = Finding & { ticket: OpenTicket | null }

export type ReadinessView = {
  checkedAt: string | null
  repo: string | null
  items: ReadinessItem[]
  gaps: number
  heldUp: HeldUp
  release: ReleaseState
}

export type ReleaseState = { mode: 'factory' | 'direct'; blocked: boolean; offered: boolean }

export const releaseStateOf = (mode: 'factory' | 'direct', findings: Finding[]): ReleaseState => {
  const blocked = mode === 'factory' && releaseBlocked(findings)
  return { mode, blocked, offered: mode === 'factory' && !blocked }
}

export const releaseBlockedOf = async (payload: Payload, f: FactsFilter): Promise<boolean> => {
  const loaded = await loadFacts(payload, f)
  return loaded ? releaseStateOf(loaded.facts.releaseMode, evaluate(loaded.facts)).blocked : true
}

export const findingOf = async (payload: Payload, f: FactsFilter, check: CheckId): Promise<Finding | null> => {
  const loaded = await loadFacts(payload, f)
  return loaded ? (evaluate(loaded.facts).find((entry) => entry.id === check) ?? null) : null
}

export const readiness = async (payload: Payload, f: FactsFilter): Promise<ReadinessView | null> => {
  const loaded = await loadFacts(payload, f)
  if (!loaded) return null
  const opened = await openedTickets(payload, f.product)
  const findings = evaluate(loaded.facts)
  const items = findings.map((finding): ReadinessItem => ({
    ...finding,
    ticket: finding.fix?.kind === 'ticket' ? openTicketOf(opened, finding.id) : null,
  }))
  return {
    release: releaseStateOf(loaded.facts.releaseMode, findings),
    checkedAt: loaded.checkedAt,
    repo: loaded.repo,
    items,
    gaps: items.filter((item) => item.status === 'gap').length,
    heldUp: await loadHeldUp(payload, f),
  }
}
