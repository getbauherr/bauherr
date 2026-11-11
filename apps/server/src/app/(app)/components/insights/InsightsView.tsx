import Link from 'next/link'
import { title as stageTitle, type Workflow } from '../../../../lib/workflow'
import { duration, durationHm } from '../../lib/format'
import { PHASES, type Insights, type PhaseKey, type TeamTime, type WipAge } from '../../lib/insights'
import { cn } from '@/lib/utils'
import { Badge } from '../ui/badge'
import { Table } from '../ui/table'

const SERIES: Record<PhaseKey, string> = { working: 'bg-primary', human: 'bg-warn', ci: 'bg-foreground/45', queued: 'bg-muted-foreground/30' }
const sec = (s: number | null) => (s == null ? '—' : duration(s))

function Tile({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3" data-testid={`tile-${id}`}>
      <dt className="label text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[22px] leading-7 font-semibold">{value}</dd>
    </div>
  )
}

const Legend = () => (
  <p className="small flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground" aria-label="Legend">
    {PHASES.map((p) => <span key={p.key} className="flex items-center gap-1"><i className={cn('inline-block size-2 rounded-[1px]', SERIES[p.key])} />{p.label}</span>)}
  </p>
)

/** Time to market of the Tickets that started in the range: tiles, where time goes per stage, throughput and WIP age. Plain markup, no chart library. */
export function InsightsView({ wf, data, wip, team, days }: { wf: Workflow; data: Insights; wip: WipAge[]; team?: TeamTime; days: number }) {
  const max = Math.max(1, ...data.stages.map((s) => s.total))
  const weeks = Math.max(1, ...data.throughput.map((w) => w.tickets))
  return (
    <div className="flex flex-col gap-8">
      <dl className="m-0 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
        <Tile id="done" label={`Done, last ${days} days`} value={String(data.done)} />
        <Tile id="lead-median" label="Lead time, median" value={sec(data.leadMedianSec)} />
        <Tile id="lead-p85" label="Lead time, 85th percentile" value={sec(data.leadP85Sec)} />
        <Tile id="cycle-median" label="Cycle time, median" value={sec(data.cycleMedianSec)} />
        {PHASES.map((p) => <Tile key={p.key} id={`share-${p.key}`} label={`Of lead time: ${p.label}`} value={data.done ? `${Math.round(data.share[p.key] * 100)} %` : '—'} />)}
      </dl>

      <section className="flex flex-col gap-3" aria-labelledby="where">
        <h2 className="heading" id="where">Where time goes</h2>
        <p className="small m-0 text-muted-foreground">Median time a Ticket spends in each stage, by phase. Lead time runs from the first event to done, cycle time from the first work to done.</p>
        {data.bottleneck && (
          <p className="m-0 flex flex-wrap items-center gap-2" data-testid="bottleneck">
            <Badge variant="warn">Bottleneck</Badge>
            <span><strong>{data.bottleneck.title}</strong>: {data.bottleneck.sentence}.</span>
          </p>
        )}
        {data.stages.length ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Median time per stage">
            {data.stages.map((s) => (
              <li key={s.stage} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 md:grid-cols-[7rem_minmax(0,1fr)_15rem]" data-testid="stage-time" data-stage={s.stage} data-bottleneck={data.bottleneck?.stage === s.stage || undefined}>
                <span className="text-[13px] font-semibold capitalize">{stageTitle(wf, s.stage)}<span className="small block font-normal text-muted-foreground">{s.tickets} {s.tickets === 1 ? 'Ticket' : 'Tickets'}</span></span>
                <span className="flex h-6 overflow-hidden rounded-sm bg-secondary" role="img" aria-label={PHASES.map((p) => `${p.label} ${sec(s.phases[p.key])}`).join(', ')}>
                  {PHASES.map((p) => s.phases[p.key] > 0 && (
                    <span key={p.key} className={cn('flex items-center justify-center overflow-hidden text-[11px] leading-6', SERIES[p.key], p.key === 'working' ? 'text-primary-foreground' : p.key === 'human' ? 'text-background' : 'text-foreground')} style={{ width: `${(s.phases[p.key] / max) * 100}%` }} title={`${p.label}: ${sec(s.phases[p.key])}`}>
                      {s.phases[p.key] / max > 0.14 && sec(s.phases[p.key])}
                    </span>
                  ))}
                </span>
                <span className="mono small col-start-2 text-muted-foreground md:col-start-auto">
                  <span className="text-foreground">{duration(s.total)}</span>{PHASES.filter((p) => s.phases[p.key] > 0).map((p) => ` · ${p.label} ${sec(s.phases[p.key])}`)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-muted-foreground">No history in this range yet.</p>
        )}
        <Legend />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="throughput">
        <h2 className="heading" id="throughput">Throughput per week</h2>
        {data.throughput.length ? (
          <ol className="m-0 flex list-none items-end gap-3 overflow-x-auto p-0" aria-label="Tickets done per week">
            {data.throughput.map((w) => (
              <li key={w.week} className="flex w-14 shrink-0 flex-col items-center gap-1" data-testid="week" data-week={w.week}>
                <span className="mono text-[13px] font-semibold">{w.tickets}</span>
                <span className="w-full rounded-t-sm bg-primary" style={{ height: `${Math.max(4, (w.tickets / weeks) * 96)}px` }} aria-hidden />
                <span className="mono text-[11px] text-muted-foreground">{w.week.replace(/^\d+-/, '')}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-muted-foreground">No Ticket reached done in this range.</p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="age">
        <h2 className="heading" id="age">WIP age</h2>
        <p className="small m-0 text-muted-foreground">Open Tickets that have waited longest in their current stage.</p>
        {wip.length ? (
          <Table data-testid="wip-age">
            <thead><tr className="label"><th>#</th><th>Ticket</th><th>Stage</th><th>In stage for</th></tr></thead>
            <tbody>
              {wip.map((t) => (
                <tr key={t.id}>
                  <td className="mono small text-muted-foreground">#{t.number}</td>
                  <td><Link className="hover:underline" href={`/tickets/${t.id}`}>{t.title}</Link></td>
                  <td className="small text-muted-foreground capitalize">{stageTitle(wf, t.stage)}</td>
                  <td className="mono small" title={t.since}>{duration(t.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="m-0 text-muted-foreground">No open Tickets.</p>
        )}
      </section>
      {team && (
        <section className="flex flex-col gap-3" aria-labelledby="team">
          <h2 className="heading" id="team">Team</h2>
          <p className="small m-0 text-muted-foreground">Active time of the agent sessions in the last {days} days and the Runs they finished. Utilisation is the share of a session&apos;s connected time that it spent on a Run.</p>
          {team.sessions.length || team.roles.length ? (
            <>
              <Table data-testid="team-roles">
                <thead><tr className="label"><th>Role</th><th>Active time</th><th>Runs finished</th></tr></thead>
                <tbody>
                  {team.roles.map((r) => (
                    <tr key={r.role} data-role={r.role}><td>{r.title}</td><td className="mono small">{durationHm(r.seconds)}</td><td className="mono small">{r.runs}</td></tr>
                  ))}
                </tbody>
              </Table>
              {team.sessions.length > 0 && (
                <Table data-testid="team-sessions">
                  <thead><tr className="label"><th>Session</th><th>Role</th><th>Active time</th><th>Connected</th><th>Utilisation</th><th>Runs finished</th></tr></thead>
                  <tbody>
                    {team.sessions.map((x) => (
                      <tr key={x.sessionId}>
                        <td><Link className="hover:underline" href={`/team#${x.sessionId}`}>{x.label}</Link></td>
                        <td className="small text-muted-foreground">{x.roleTitle}</td>
                        <td className="mono small">{durationHm(x.seconds)}</td>
                        <td className="mono small">{durationHm(x.connectedSeconds)}</td>
                        <td className="mono small">{x.utilisation == null ? '—' : `${Math.round(x.utilisation * 100)} %`}</td>
                        <td className="mono small">{x.runs}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </>
          ) : (
            <p className="m-0 text-muted-foreground">No session was connected in this range.</p>
          )}
        </section>
      )}
    </div>
  )
}
