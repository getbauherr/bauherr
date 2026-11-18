import { ciLinkLabel, forgeLinkOf } from '../../../lib/ci-text'
import type { RunHealthState } from '../../../lib/run-health'
import { ago } from './format'
import { isWebUrl } from './url'

export type RunLink = { label: string; href: string; external: boolean }

const forgeName = (kind?: string | null) => (kind === 'github' ? 'GitHub' : kind === 'gitlab' ? 'GitLab' : '')

export const runLinks = (a: { forge?: string | null; prUrl?: string | null; ciUrl?: string | null; issueUrl?: string | null; ticket: { id: number; number: number } }): RunLink[] => {
  const rows: RunLink[] = []
  const pr = forgeLinkOf(a.forge, a.prUrl)
  if (pr) rows.push({ label: pr.label.replace(/^Open (.)/, (_, c: string) => c.toUpperCase()), href: pr.href, external: true })
  if (isWebUrl(a.ciUrl)) rows.push({ label: ciLinkLabel(a.forge), href: a.ciUrl, external: true })
  if (isWebUrl(a.issueUrl)) rows.push({ label: `Issue #${a.ticket.number}${forgeName(a.forge) && ` on ${forgeName(a.forge)}`}`, href: a.issueUrl, external: true })
  rows.push({ label: `Ticket #${a.ticket.number}`, href: `/tickets/${a.ticket.id}`, external: false })
  return rows
}

const RUNNING: RunHealthState[] = ['working', 'stuck', 'session_gone', 'waiting_ci', 'waiting_review']

export const timelineEmpty = (state: RunHealthState, startedAt: string | null | undefined, now: number): string =>
  RUNNING.includes(state)
    ? `The agent has not reported a step yet.${startedAt ? ` It started ${ago(startedAt, now)}.` : ''} Steps appear here when it reports them.`
    : state === 'queued' || state === 'awaiting_session' ? 'Nothing yet. The agent has not started this Run.' : 'This Run recorded no steps.'

export const exactTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

export const runTimes = (r: { createdAt?: string | null; startedAt?: string | null; finishedAt?: string | null }, lastReportAt: string | null): { label: string; iso: string }[] =>
  ([['Queued', r.createdAt], ['Started', r.startedAt], ['Last report', lastReportAt], ['Ended', r.finishedAt]] as const).flatMap(([label, iso]) => (iso ? [{ label, iso }] : []))
