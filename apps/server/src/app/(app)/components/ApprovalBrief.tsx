import type { ApprovalBrief as Brief, BriefKind } from '../lib/brief'
import { noVisibleReason } from '../lib/brief'
import { isWebUrl } from '../lib/url'
import { ProofList } from './ProofList'
import { Badge } from './ui/badge'

const KIND: Record<BriefKind, { label: string; variant: 'accent' | 'neutral' }> = { visible: { label: 'Visible', variant: 'accent' }, behaviour: { label: 'Behaviour', variant: 'neutral' }, internal: { label: 'Internal', variant: 'neutral' } }

const Part = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-1" aria-label={title}>
    <h3 className="heading m-0 text-[15px]">{title}</h3>
    {children}
  </section>
)

const List = ({ items }: { items: string[] }) => (
  <ul className="small m-0 flex list-disc flex-col gap-1 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
)

export function ApprovalBrief({ brief, admin = true }: { brief: Brief; admin?: boolean }) {
  const reason = noVisibleReason(brief)
  const checks = [brief.checks.ci ?? 'CI: unknown', brief.checks.testsAdded == null ? 'Tests added: unknown' : `Tests added: ${brief.checks.testsAdded}`, ...brief.checks.noProof.map((p) => `No proof for ${p.rule}: ${p.reason || 'no reason given'}`)]
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Approval brief" data-testid="approval-brief">
      <h2 className="heading m-0 text-[17px]">Approval brief</h2>
      <Part title="What changes for whom">
        {reason && <p className="m-0 body" data-testid="no-visible-change"><strong>No visible change.</strong> <span className="text-muted-foreground">{reason}</span></p>}
        {brief.changes.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="brief-changes">
            {brief.changes.map((c, i) => <li key={i} className="flex items-start gap-2 text-[15px]"><Badge variant={KIND[c.kind].variant} className="mt-0.5 shrink-0">{KIND[c.kind].label}</Badge><span className="min-w-0">{c.text}</span></li>)}
          </ul>
        )}
      </Part>
      {brief.proof && <ProofList data={brief.proof} />}
      <Part title="Not included">{brief.notIncluded.length ? <List items={brief.notIncluded} /> : <p className="small m-0 text-muted-foreground">Nothing listed.</p>}</Part>
      <Part title="Risk and rollback"><p className="small m-0">{brief.risk || <span className="text-muted-foreground">Not stated.</span>}</p></Part>
      <Part title="Checks">
        <List items={checks} />
        {brief.noted.length > 0 && <><p className="label m-0 mt-1 text-muted-foreground">Noted, not sent back</p><List items={brief.noted.map((n) => `${n.text} (${n.reason})`)} /></>}
      </Part>
      <Part title="Links">
        <ul className="small m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          {brief.links.filter((l) => admin || !l.href.startsWith('/runs/')).map((l) => {
            const web = isWebUrl(l.href)
            return <li key={l.href}>{web || /^\/(?!\/)/.test(l.href) ? <a className="min-h-6 py-[3px] text-primary underline-offset-2 hover:underline" href={l.href} {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{l.label}</a> : l.label}</li>
          })}
        </ul>
      </Part>
    </section>
  )
}
