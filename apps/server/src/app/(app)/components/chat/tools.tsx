'use client'
import { useAuiState, type ToolCallMessagePartProps } from '@assistant-ui/react'
import Link from 'next/link'
import { useState, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { artifactOf, type Decision, type Outcome } from './adapter'
import { ChevronRight, Shield } from './icons'
import { Options, ProductCard, RequestCardSlot } from './request'
import { ProofList } from '../ProofList'

/** One line per read tool: what it looked up and whether it worked; the result is one click away. */
const Receipt: FC<{ summary: string; result?: Outcome }> = ({ summary, result }) => (
  <details className="group my-1 text-[13px] leading-5 text-muted-foreground" data-testid="read-receipt">
    <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
      <span className="transition-transform group-open:rotate-90"><ChevronRight size={14} /></span>
      <span className="min-w-0 truncate">{summary}</span>
      <span className={cn('shrink-0', !result ? 'animate-pulse' : result.ok ? 'text-ok' : 'text-destructive')}>{!result ? 'running' : result.ok ? 'ok' : 'failed'}</span>
    </summary>
    {result && <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-secondary p-2 font-mono text-xs whitespace-pre-wrap">{result.text}</pre>}
  </details>
)

/** What running the approved call did: "Done." on success; a failure, a decline or "Already decided." in the server's words. */
const OutcomeLine: FC<{ result?: Outcome; href?: string }> = ({ result, href }) =>
  result ? (
    <p role="status" data-testid="confirm-outcome" className={cn('my-1 text-[13px] leading-5', result.ok ? 'text-ok' : 'text-muted-foreground')}>
      {result.ok ? (href ? result.text : 'Done.') : result.text}
      {href && <> <Link href={href} className="text-primary underline underline-offset-2">Open the request</Link></>}
    </p>
  ) : null

/** The approval card of a `confirm` tool: the TL;DR rows, Approve / Decline (with an optional reason), then its outcome. Nothing runs before the person decides. */
const Card: FC<ToolCallMessagePartProps> = ({ result, addResult, artifact }) => {
  const a = artifact as Extract<NonNullable<ReturnType<typeof artifactOf>>, { kind: 'confirm' }>
  const status = useAuiState((s) => s.message.status?.type)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const decision = result as Decision | undefined
  const answer = (d: Decision) => addResult(d)
  return (
    <section data-testid="confirm-card" data-state={decision ? (decision.approved ? 'approved' : 'declined') : 'pending'} className={cn('my-2 flex flex-col gap-2 rounded-md border bg-card p-3 text-card-foreground', a.destructive && 'border-destructive')}>
      <h3 className="flex items-center gap-2 text-[14px] font-semibold leading-5"><Shield />{a.title ?? a.summary}</h3>
      {!!a.details?.length && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-5">
          {a.details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className="min-w-0 wrap-anywhere whitespace-pre-line">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.proof && <ProofList data={a.proof} />}
      {decision ? (
        <p className="text-[13px] leading-5 text-muted-foreground">{decision.approved ? (status === 'running' ? 'Approved, running...' : 'Approved') : a.decline ? 'Kept as a draft' : `Declined${decision.reason ? `: ${decision.reason}` : ''}`}</p>
      ) : status !== 'requires-action' ? (
        <p className="text-[13px] leading-5 text-muted-foreground">Not decided</p>
      ) : declining ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); answer({ approved: false, reason: reason.trim() || undefined }) }}>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} aria-label="Reason (optional)" placeholder="Reason (optional)" className="h-9 rounded-md border bg-background px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="flex gap-2"><Button type="submit" variant="outline" size="sm">Decline</Button><Button type="button" variant="ghost" size="sm" onClick={() => setDeclining(false)}>Back</Button></div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={a.destructive ? 'destructive' : 'default'} onClick={() => answer({ approved: true })}>{a.approve ?? 'Approve'}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => (a.noReason ? answer({ approved: false }) : setDeclining(true))}>{a.decline ?? 'Decline'}</Button>
        </div>
      )}
    </section>
  )
}

/** Tool widgets are picked by the `kind` the server sent, never by tool name. */
export const ToolPart: FC<ToolCallMessagePartProps> = (props) => {
  const a = artifactOf(props)
  if (a?.kind === 'confirm') return <Card {...props} />
  if (a?.kind === 'outcome') return <OutcomeLine result={props.result as Outcome | undefined} href={a.href} />
  if (a?.kind === 'product') return <ProductCard thread={a.thread} products={a.products} current={a.current} />
  if (a?.kind === 'request-card') return <RequestCardSlot session={a.session} />
  if (a?.kind === 'options') return <Options options={a.options} />
  return <Receipt summary={(a as { summary?: string } | undefined)?.summary ?? props.toolName} result={props.result as Outcome | undefined} />
}
