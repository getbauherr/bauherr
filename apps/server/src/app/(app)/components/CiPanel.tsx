import type { ReactNode } from 'react'
import type { CiRow, CiSummary } from '../../../lib/ci-summary'
import { isWebUrl } from '../lib/url'
import { duration } from '../lib/format'
import { Badge } from './ui/badge'

const PASSED = ['success', 'neutral', 'skipped']

const chipOf = (r: CiRow): { variant: 'ok' | 'destructive' | 'neutral'; text: string } =>
  r.status !== 'completed' ? { variant: 'neutral', text: r.status === 'queued' || r.status === 'pending' ? 'Queued' : 'Running' }
  : PASSED.includes(r.conclusion ?? '') ? { variant: 'ok', text: '✓ Passed' }
  : { variant: 'destructive', text: '× Failed' }

/**
 * The stored checks of the Ticket's open merge request, one row per check (database only, never a live forge call). A row shows its state (the word Failed for a failing one),
 * and "running for N min" while it runs: the summary stores `startedAt` only, so a completed check shows no duration. "Checked" is the age of `updatedAt`, in seconds within 60 s.
 */
export function CiPanel({ summary, forge, now = Date.now() }: { summary: CiSummary; /** The forge link, when the action bar has no room for it (it holds one secondary). */ forge?: ReactNode; now?: number }) {
  const sec = Math.max(0, Math.round((now - Date.parse(summary.updatedAt)) / 1000))
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ci-checks" data-testid="ci-panel">
      <h2 className="heading flex flex-wrap items-baseline gap-x-3" id="ci-checks">
        CI checks
        <span className="small font-normal text-muted-foreground">
          <time dateTime={summary.updatedAt} title={summary.updatedAt.slice(0, 16).replace('T', ' ') + ' UTC'}>Checked {sec < 60 ? `${sec} s ago` : `${Math.round(sec / 60)} min ago`}</time>
        </span>
      </h2>
      {forge}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {summary.rows.map((r) => {
          const chip = chipOf(r)
          const running = chipOf(r).text === 'Running' && r.startedAt ? duration((now - Date.parse(r.startedAt)) / 1000) : null
          return (
            <li key={r.name} className="small flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="ci-row">
              <Badge variant={chip.variant}>{chip.text}</Badge>
              {isWebUrl(r.url) ? (
                <a className={chip.variant === 'destructive' ? 'text-destructive' : 'text-primary'} href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.name}<span className="sr-only"> (opens in new tab)</span>
                </a>
              ) : <span className={chip.variant === 'destructive' ? 'text-destructive' : undefined}>{r.name}</span>}
              {running && <span className="text-muted-foreground">running for {running}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
