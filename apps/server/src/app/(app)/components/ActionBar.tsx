import Link from 'next/link'
import { acceptStagingAction, approvePlanAction, approveProductionAction, grantReviewRoundAction, rerunStage, stopReviewAction } from '../lib/actions'
import { GATES } from '../lib/gates'
import type { Need } from '../lib/needs-you'
import { SubmitButton } from './SubmitButton'
import { Button } from './ui/button'

type Props = {
  ticket: number
  need: Need | null
  stage: string
  missing: string[]
  open: number
  /** Latest Run id, for the re-run action. */
  run: number | null
  /** The bar's sentence when nothing is asked of the owner. */
  idle: string
  /** Workflow run of a failed release. */
  releaseRunUrl?: string | null
}

const Post = ({ ticket, action, children, variant = 'default' }: { ticket: number; action: (f: FormData) => Promise<void>; children: string; variant?: 'default' | 'outline' }) => (
  <form action={action}>
    <input type="hidden" name="ticket" value={ticket} />
    <SubmitButton variant={variant}>{children}</SubmitButton>
  </form>
)

/** The one place the owner acts on a Ticket: same position in every state, one primary button. */
export function ActionBar({ ticket, need, stage, missing, open, run, idle, releaseRunUrl }: Props) {
  const gate = need ? GATES[need] : null
  const ctx = { stage, missing, open }
  const verb = gate?.verb(ctx) ?? ''
  const primary = !need ? null : (() => {
    switch (need) {
      case 'Approve plan': return <Post ticket={ticket} action={approvePlanAction}>{verb}</Post>
      case 'Accept on staging':
      case 'Staging not confirmed': return <Post ticket={ticket} action={acceptStagingAction}>{verb}</Post>
      case 'Approve production':
      case 'Production deploy failed': return <Post ticket={ticket} action={approveProductionAction}>{verb}</Post>
      case 'Release failed': return releaseRunUrl ? <Button asChild><a href={releaseRunUrl} target="_blank" rel="noreferrer">{verb}</a></Button> : null
      case 'Round cap reached': return <Post ticket={ticket} action={grantReviewRoundAction}>{verb}</Post>
      case 'Run needs you':
      case 'Run failed': return run ? <form action={rerunStage.bind(null, run)}><SubmitButton variant="default">{verb}</SubmitButton></form> : null
      case 'Answer decisions':
      case 'Answer questions': return <Button asChild><a href="#answer">Answer {open} question{open === 1 ? '' : 's'}</a></Button>
      case 'Configure production checks': return <Button asChild><Link href="/settings/products">{verb}</Link></Button>
    }
  })()
  const secondary = need === 'Round cap reached' ? <Post ticket={ticket} action={stopReviewAction} variant="outline">Stop</Post> : gate?.secondary ? <Button asChild variant="outline"><a href="#changes">{gate.secondary}</a></Button> : null
  return (
    <div
      className="sticky top-0 z-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-md border border-border bg-card px-4 py-3 text-card-foreground max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:flex-col max-sm:items-stretch max-sm:rounded-none max-sm:border-0 max-sm:border-t max-sm:pb-[calc(var(--space-3)+env(safe-area-inset-bottom))] [&_form]:contents"
      data-testid="action-bar"
      role="region"
      aria-label="Next step"
    >
      <p className="min-w-0 flex-[1_1_20ch] text-pretty">{gate ? gate.sentence(ctx) : idle}</p>
      {gate && (
        <div className="flex flex-wrap items-center gap-3 max-sm:justify-end">
          {gate.kind !== 'questions' && <a className="small text-primary" href="#details">Show details</a>}
          {secondary}
          {primary}
        </div>
      )}
    </div>
  )
}
