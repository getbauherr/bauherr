import type { CiRow, CiSummary } from '../../../lib/ci-summary'
import { isWebUrl } from '../lib/url'
import { ago } from '../lib/format'
import { Badge } from './ui/badge'

const PASSED = ['success', 'neutral', 'skipped']

const chipOf = (r: CiRow): { variant: 'ok' | 'destructive' | 'neutral'; text: string } =>
  r.status !== 'completed' ? { variant: 'neutral', text: r.status === 'queued' || r.status === 'pending' ? 'Queued' : 'Running' }
  : PASSED.includes(r.conclusion ?? '') ? { variant: 'ok', text: '✓ Passed' }
  : { variant: 'destructive', text: '× Failed' }

/**
 * The stored checks of the Ticket's open merge request, one row per check (database only, never a live forge call). `updatedAt` is the time of the last
 * change of the summary, so the age reads "Updated", not "Checked".
 */
export function CiPanel({ summary }: { summary: CiSummary }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="ci-checks" data-testid="ci-panel">
      <h2 className="heading flex flex-wrap items-baseline gap-x-3" id="ci-checks">
        CI checks
        <span className="small font-normal text-muted-foreground">
          <time dateTime={summary.updatedAt} title={summary.updatedAt.slice(0, 16).replace('T', ' ') + ' UTC'}>Updated {ago(summary.updatedAt)}</time>
        </span>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {summary.rows.map((r) => {
          const chip = chipOf(r)
          return (
            <li key={r.name} className="small flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="ci-row">
              <Badge variant={chip.variant}>{chip.text}</Badge>
              {isWebUrl(r.url) ? (
                <a className={chip.variant === 'destructive' ? 'text-destructive' : 'text-primary'} href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.name}<span className="sr-only"> (opens in new tab)</span>
                </a>
              ) : <span className={chip.variant === 'destructive' ? 'text-destructive' : undefined}>{r.name}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
