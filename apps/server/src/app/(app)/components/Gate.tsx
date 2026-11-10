import { requestChangesAction } from '../lib/actions'
import { Markdown } from './Markdown'
import { SubmitButton } from './SubmitButton'
import { Card } from './ui/card'

export function Gate({ plan }: { plan: { title: string; steps: number } | null }) {
  return (
    <Card asChild className="max-w-[640px] gap-4 p-6">
      <section aria-label="Approve plan">
        <dl className="body m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:break-words [&_dt]:text-muted-foreground">
          <dt>Approves</dt><dd>{plan ? `${plan.title} · ${plan.steps} ${plan.steps === 1 ? 'step' : 'steps'}` : 'Plan comment not readable, open it on the forge.'}</dd>
        </dl>
      </section>
    </Card>
  )
}

type ReleaseGateProps = { ticket: number; timedOut: boolean; summaryHtml: string | null }

/** The staging summary, and the Request-changes form, which the bar's `#changes` link reveals through `:target`. */
export function ReleaseGate({ ticket, timedOut, summaryHtml }: ReleaseGateProps) {
  return (
    <>
      {(timedOut || summaryHtml) && (
        <Card asChild className="max-w-[640px] gap-4 p-6">
          <section aria-label="Staging">
            {timedOut && <p className="body">The deploy was not observed on staging within 60 minutes. Check staging yourself; you can still accept.</p>}
            {summaryHtml && <Markdown html={summaryHtml} />}
          </section>
        </Card>
      )}
      <Card asChild className="hidden max-w-[640px] scroll-mt-[calc(72px+var(--space-4))] items-start gap-4 p-6 target:flex">
        <form action={requestChangesAction} id="changes">
          <input type="hidden" name="ticket" value={ticket} />
          <label className="flex flex-col gap-1 self-stretch">
            <span className="label text-muted-foreground">What needs to change</span>
            <textarea className="rounded-md border border-border bg-secondary px-3 py-2 text-[15px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" name="note" required rows={3} />
          </label>
          <SubmitButton>Request changes</SubmitButton>
        </form>
      </Card>
    </>
  )
}
