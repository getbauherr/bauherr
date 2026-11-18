import Link from 'next/link'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { ASKED } from '../../../../lib/workflow-labels'
import { whenText } from '../../../../lib/workflow-when'
import type { Workflow } from '../../../../lib/workflow'
import { BOX, layoutJobs, type ViewJob } from '../../lib/job-view'
import { Badge } from '../ui/badge'

export type JobTicket = { id: number; number: number; title: string }
const SHOWN = 2

function JobCard({ wf, job, after, tickets, selected, href }: { wf: Workflow; job: ViewJob; after: string[]; tickets: JobTicket[]; selected: boolean; href: string }) {
  const who = job.kind === 'human' ? `Asked of the ${ASKED[job.by ?? 'bauherr']}` : `Worked by ${wf.roles.find((r) => r.id === job.role)?.title ?? job.role ?? 'any agent'}`
  return (
    <article aria-labelledby={`job-${job.id}`} aria-current={selected ? 'true' : undefined} data-testid="job-card" data-job={job.id} data-count={tickets.length} className="flex h-full flex-col gap-1.5 overflow-hidden rounded-md border border-border bg-card p-3 [&>*]:shrink-0 aria-[current]:ring-2 aria-[current]:ring-primary">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`job-${job.id}`} className="heading m-0 min-w-0 truncate">{job.title}</h2>
        <Badge variant={job.kind === 'human' ? 'warn' : 'neutral'}>{job.kind === 'human' ? 'Human' : 'Agent'}</Badge>
      </div>
      <p className="small m-0 truncate" data-testid="job-who">{who}</p>
      {job.skill && <p className="small m-0 truncate text-muted-foreground">Skill <code className="mono">{job.skill}</code></p>}
      <p className="small m-0 line-clamp-2 text-muted-foreground" data-testid="job-when">{job.when ? whenText(job.when) : 'Every Ticket'}</p>
      <p className="small m-0 text-muted-foreground" data-testid="job-blocking">{job.blocking ? 'Blocking: the stage waits for it' : 'Not blocking: the stage moves on without it'}</p>
      {after.length > 0 && <p className="small m-0 text-muted-foreground sm:hidden">After {after.join(', ')}</p>}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-1.5" data-testid="job-tickets">
        {tickets.length ? (
          <>
            <p className="small m-0 text-muted-foreground">{tickets.length} {tickets.length === 1 ? 'Ticket' : 'Tickets'} here</p>
            <ul className="small m-0 flex list-none flex-col p-0">
              {tickets.slice(0, SHOWN).map((t) => <li key={t.id} className="truncate"><Link className="inline-flex min-h-6 items-center text-primary" href={`/tickets/${t.id}`}>#{t.number} {t.title}</Link></li>)}
            </ul>
            <Link className="small inline-flex min-h-6 items-center text-primary" href={href}>{selected ? 'Show all Tickets of the stage' : tickets.length > SHOWN ? `Show all ${tickets.length} Tickets of this Job` : 'Show only these in the list'}</Link>
          </>
        ) : (
          <p className="small m-0 text-muted-foreground">No Ticket here right now</p>
        )}
      </div>
    </article>
  )
}

export function StageJobs({ wf, jobs, tickets, selected, hrefOf }: { wf: Workflow; jobs: ViewJob[]; tickets: Map<string, JobTicket[]>; selected?: string; hrefOf: (id: string) => string }) {
  const L = layoutJobs(jobs)
  const titleOf = new Map(jobs.map((j) => [j.id, j.title]))
  return (
    <div className="overflow-x-auto" data-testid="stage-jobs">
      <ol className="relative m-0 flex list-none flex-col gap-2 p-0 sm:block sm:[height:var(--h)] sm:[width:var(--w)]" style={{ '--h': `${L.height}px`, '--w': `${L.width}px` } as CSSProperties} aria-label="Jobs">
        {[{ x: 0, w: L.width, h: L.top, lane: true }, ...L.gaps.map((g) => ({ ...g, h: L.height, lane: false }))].map((r, i) => {
          const mine = L.edges.flatMap((e) => e.segs.flatMap((s, k) => ((s[1] === s[3] && s[1] < L.top) === r.lane && (r.lane || (Math.min(s[0], s[2]) >= r.x && Math.max(s[0], s[2]) <= r.x + r.w)) ? [{ e, s, last: k === e.segs.length - 1 }] : [])))
          return (
            <svg key={r.x + (r.lane ? 'lane' : '')} className="pointer-events-none absolute top-0 hidden text-muted-foreground sm:block" style={{ left: r.x }} width={r.w} height={r.h} aria-hidden>
              {i === 0 && <defs><marker id="job-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L8 4L0 8z" fill="currentColor" /></marker></defs>}
              <g transform={`translate(${-r.x} 0)`}>
                {mine.map(({ e, s, last }, k) => <path key={`${e.key}${k}`} {...(last && { 'data-edge': e.key, 'data-skip': e.skip || undefined, markerEnd: 'url(#job-arrow)' })} d={`M${s[0]} ${s[1]}L${s[2]} ${s[3]}`} className={cn('fill-none stroke-current [stroke-width:1.5]', e.skip && '[stroke-dasharray:5_4]')} />)}
              </g>
            </svg>
          )
        })}
        {jobs.map((j) => {
          const p = L.nodes.get(j.id)!
          return (
            <li key={j.id} className="sm:absolute sm:z-10 sm:[height:var(--bh)] sm:[left:var(--x)] sm:[top:var(--y)] sm:[width:var(--bw)]" style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--bw': `${BOX.w}px`, '--bh': `${BOX.h}px` } as CSSProperties}>
              <JobCard wf={wf} job={j} after={j.needs.map((n) => titleOf.get(n) ?? n)} tickets={tickets.get(j.id) ?? []} selected={selected === j.id} href={hrefOf(j.id)} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}
