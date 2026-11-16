import { is, type Workflow } from './workflow'

type Track = { waitingFor?: string | null; reviewState?: string | null; releaseChecksState?: string | null }

/** The Ticket waits for the checks of its merge request or release. */
export const ciWait = (wf: Workflow, stage: string, t: Track): boolean =>
  t.waitingFor === 'checks' || (is(wf, stage, 'review') && t.reviewState === 'waiting_checks') || t.releaseChecksState === 'waiting'

/** "Open pull request #88 on GitHub" / "Open merge request !88 on GitLab" / "Open merge request", linking `url`; null without a URL. */
export const forgeButton = (kind: 'github' | 'gitlab' | null | undefined, url: string | null | undefined): { label: string; href: string } | null => {
  if (!url) return null
  const n = /\/(?:pull|merge_requests)\/(\d+)/.exec(url)?.[1]
  if (!n || !kind) return { label: 'Open merge request', href: url }
  return { label: kind === 'github' ? `Open pull request #${n} on GitHub` : `Open merge request !${n} on GitLab`, href: url }
}

export type TicketLive = { chip: string; tone: 'neutral' | 'accent'; sentence: string; forge: { label: string; href: string } | null }

/** What a Ticket with a running Run is truthfully doing: waiting for CI (with the forge link) or working. Null when neither applies. */
export const ticketLive = (row: { ci: boolean; run: { status: string; startedAt?: string | null } | null; forge?: 'github' | 'gitlab' | null; prUrl?: string | null }, now = Date.now()): TicketLive | null => {
  if (row.ci) return { chip: 'Waiting for CI', tone: 'neutral', sentence: 'Waiting for CI.', forge: forgeButton(row.forge, row.prUrl) }
  if (row.run?.status !== 'running') return null
  const min = row.run.startedAt ? Math.max(0, Math.round((now - +new Date(row.run.startedAt)) / 60000)) : null
  return { chip: 'Working', tone: 'accent', sentence: min === null ? 'Working.' : `Working. Started ${min} min ago.`, forge: null }
}
