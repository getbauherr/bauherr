import Link from 'next/link'
import { stageLabel } from '../lib/needs-you'
import { ago } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import type { StageHistoryData } from '../lib/stage-history'
import { Markdown } from './Markdown'
import { StatusChip } from './StatusChip'
import { Badge } from './ui/badge'
import { Table } from './ui/table'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h3 className="label m-0 text-muted-foreground">{title}</h3>
    {children}
  </section>
)

/** The panel under the stage strip: what happened in one stage. Non-Admins get no Run ids, mode or cost. */
export function StageHistory({ data, admin }: { data: StageHistoryData; admin: boolean }) {
  const { runs, plan, mr, reviews, release } = data
  return (
    <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-4" aria-label="Stage history" data-testid="stage-history">
      <h2 className="heading m-0">{stageLabel(data.stage).replace(/^./, (c) => c.toUpperCase())} history</h2>
      {runs.length > 0 && (
        <Table>
          <thead>
            <tr className="label">{(admin ? ['Run', 'Mode', 'Status', 'When', 'Duration', 'Cost', 'Reason'] : ['Status', 'When', 'Reason']).map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                {admin && <><td className="mono"><Link className="text-primary" href={`/runs/${r.id}`}>#{r.id}</Link></td><td>{r.mode}</td></>}
                <td><StatusChip status={r.status} reason={r.reason} /></td>
                <td className="text-muted-foreground">{ago(r.createdAt)}</td>
                {admin && <><td className="mono">{r.duration ?? '—'}</td><td className="mono">{r.costUsd == null ? '—' : `$${r.costUsd.toFixed(2)}`}</td></>}
                <td className="small max-w-[40ch] truncate text-muted-foreground" title={r.reason ?? r.evidence}>{r.reason ?? (r.evidence || '—')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {plan && (
        <Section title="Plan">
          {plan.markdown ? <Markdown html={renderMarkdown(plan.markdown)} /> : <p className="m-0 text-muted-foreground">No plan Comment.</p>}
          {plan.decisions.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Decisions">
              {plan.decisions.map((d) => <li key={d.id}><span className="mono">{d.id}</span> {d.title}: <span className={d.answer ? '' : 'text-muted-foreground'}>{d.answer ?? 'open'}</span></li>)}
            </ul>
          )}
        </Section>
      )}
      {mr && (
        <Section title="Merge request">
          <p className="m-0"><a className="text-primary" href={mr.url}>{mr.url}</a>{mr.headSha && <> · <span className="mono">{mr.headSha.slice(0, 7)}</span></>}</p>
          {mr.checks.length > 0 && (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Checks">
              {mr.checks.map((c) => <li key={c.name}><Badge variant={c.state === 'passed' ? 'ok' : c.state === 'failed' ? 'destructive' : 'neutral'}>{c.name}: {c.state}</Badge></li>)}
            </ul>
          )}
        </Section>
      )}
      {reviews && reviews.length > 0 && (
        <Section title="Review rounds">
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {reviews.map((v, i) => <li key={i}>Round {reviews.length - i}: {v.verdict} · {v.findings} {v.findings === 1 ? 'finding' : 'findings'}{v.sha && <> · <span className="mono">{v.sha.slice(0, 7)}</span></>}</li>)}
          </ol>
        </Section>
      )}
      {release && (
        <Section title="Staging and production">
          {release.summary ? <Markdown html={renderMarkdown(release.summary)} /> : <p className="m-0 text-muted-foreground">No staging summary.</p>}
          <p className="m-0">{release.accepted ? 'Accepted on staging' : 'Not accepted on staging yet'}{release.production && <> · Production: {release.production.replace(/_/g, ' ')}</>}</p>
        </Section>
      )}
      {!runs.length && !plan && !mr && !release && <p className="m-0 text-muted-foreground">Nothing happened in this stage.</p>}
    </section>
  )
}
