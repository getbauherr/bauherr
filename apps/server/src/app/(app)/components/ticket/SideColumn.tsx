import Link from 'next/link'
import type { ReactNode } from 'react'
import type { TicketView } from '../../../../core/views/ticket'
import { shortDate } from '../../lib/format'
import { FINDING_WORDS, FORGE_NAMES, pullLabel } from '../../lib/ticket'
import { WordBadge } from '../WordBadge'
import { CARD } from './Section'
import { ForgeLink } from './ForgeLink'
import { RunLink } from './RunLink'
import { RefText } from '../RefText'
import { TicketRef } from '../TicketRef'
import { TimeCost } from './TimeCost'

function Aside({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={`${CARD} grid gap-2 p-4`}>
      <h2 className="label m-0 text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Source({ view }: { view: TicketView }) {
  const { source } = view.record
  return (
    <Aside title="Source">
      <span>
        Issue <span className="mono">#{source.number}</span> by {source.reporter}
        {source.external ? ', an outside author' : ''}
      </span>
      {view.source && (
        <ForgeLink href={view.source.url} label={`Open issue #${source.number} on ${FORGE_NAMES[source.forge]}`} />
      )}
    </Aside>
  )
}

const verdictOf = (view: TicketView): string | null => {
  if (view.events.some((event) => event.type === 'verify.overridden')) return 'Accepted without a passing verification.'
  return view.events.some((event) => event.type === 'verify.passed') ? 'Passed verification.' : null
}

function ReviewedBy({ runs }: { runs: TicketView['runs'] }) {
  const review = runs.findLast((entry) => entry.role === 'reviewer' && entry.status === 'submitted')
  return review ? <>, reviewed by <RunLink id={review.id} word="run" /></> : null
}

function Verdict({ view }: { view: TicketView }) {
  const { pullRequest: pull } = view
  const verdict = verdictOf(view)
  const run = view.runs.findLast((entry) => entry.role === 'verifier' && entry.status === 'submitted')
  if (!pull && !verdict) return null
  const passed = pull?.checks.filter((check) => check.conclusion === 'success').length ?? 0
  return (
    <Aside title={verdict ? 'Verdict' : 'Pull request'}>
      {verdict && (
        <span className="small">
          {verdict}
          {run && <> <RunLink id={run.id} /></>}
          <ReviewedBy runs={view.runs} />
        </span>
      )}
      {pull && (
        <>
          <span className="small">
            Patch <span className="mono">{pull.headSha.slice(0, 7)}</span>
            {pull.checks.length > 0 && <> · CI <span className="mono">{passed}/{pull.checks.length}</span> passed</>}
          </span>
          <ForgeLink href={pull.url} label={`Open ${pullLabel(view.record.source.forge, pull.number)}`} />
        </>
      )}
    </Aside>
  )
}

function Findings({ view }: { view: TicketView }) {
  if (view.record.findings.length === 0) return null
  return (
    <Aside title="Review findings" id="findings">
      {view.record.findings.map((finding) => (
        <div key={finding.id} className="small grid justify-items-start gap-1">
          <WordBadge word={FINDING_WORDS[finding.status]} />
          <span><RefText text={finding.text} repo={view.record.source.repo} /></span>
          <span className="mono text-muted-foreground">{finding.evidence.pointer}</span>
        </div>
      ))}
    </Aside>
  )
}

function OtherPulls({ view }: { view: TicketView }) {
  if (view.otherPulls.length === 0) return null
  return (
    <Aside title="Other pull requests">
      {view.otherPulls.map((pull) => (
        <a
          key={pull.number}
          href={pull.url}
          target="_blank"
          rel="noopener noreferrer"
          className="small hover:underline"
        >
          <span className="mono">#{pull.number}</span> {pull.title} · {pull.author} · {pull.state}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ))}
    </Aside>
  )
}

function AnswersUsed({ view }: { view: TicketView }) {
  const kind = view.card?.card
  const used = kind === 'brief' ? view.statementsUsed.brief : kind === 'result' ? view.statementsUsed.result : []
  if (used.length === 0) return null
  return (
    <Aside title="Memory used">
      {used.map((statement) => (
        <span key={statement.id} className="small">
          &quot;<RefText text={statement.text} repo={view.record.source.repo} />&quot;{' '}
          <Link href={`/memory/${statement.id}`} className="text-muted-foreground underline">
            Memory
          </Link>{' '}
          {statement.record !== null && statement.ticket !== null && (
            <>
              <TicketRef recordId={statement.record} number={statement.ticket} className="text-muted-foreground" />
              , {shortDate(statement.at)}
            </>
          )}{' '}
          <span className="text-muted-foreground">({statement.scopeLabel})</span>
        </span>
      ))}
    </Aside>
  )
}

function Similar({ view }: { view: TicketView }) {
  if (view.similarItems.length === 0) return null
  return (
    <Aside title="Similar tickets">
      {view.similarItems.map((item) => (
        <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="small hover:underline">
          <span className="mono">#{item.number}</span> {item.title} · {item.state}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ))}
    </Aside>
  )
}

export function SideColumn({ view }: { view: TicketView }) {
  return (
    <div className="grid content-start gap-4">
      <Source view={view} />
      <TimeCost timing={view.timing} />
      <AnswersUsed view={view} />
      <Verdict view={view} />
      <Findings view={view} />
      <OtherPulls view={view} />
      <Similar view={view} />
    </div>
  )
}
