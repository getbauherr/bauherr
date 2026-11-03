import Link from 'next/link'
import { acceptStagingAction, approvePlanAction, approveProductionAction, grantReviewRoundAction, rerunStage, stopReviewAction } from '../lib/actions'
import { GATES } from '../lib/gates'
import type { Need } from '../lib/needs-you'
import { SubmitButton } from './SubmitButton'

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

const Post = ({ ticket, action, children, className = 'btn primary' }: { ticket: number; action: (f: FormData) => Promise<void>; children: string; className?: string }) => (
  <form action={action}>
    <input type="hidden" name="ticket" value={ticket} />
    <SubmitButton className={className}>{children}</SubmitButton>
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
      case 'Release failed': return releaseRunUrl ? <a className="btn primary" href={releaseRunUrl} target="_blank" rel="noreferrer">{verb}</a> : null
      case 'Round cap reached': return <Post ticket={ticket} action={grantReviewRoundAction}>{verb}</Post>
      case 'Run needs you':
      case 'Run failed': return run ? <form action={rerunStage.bind(null, run)}><SubmitButton className="btn primary">{verb}</SubmitButton></form> : null
      case 'Answer decisions': return <a className="btn primary" href="#answer">{verb}</a>
      case 'Answer questions': return <a className="btn primary" href="#decisions">{verb}</a>
      case 'Configure production checks': return <Link className="btn primary" href="/settings/products">{verb}</Link>
    }
  })()
  const secondary = need === 'Round cap reached' ? <Post ticket={ticket} action={stopReviewAction} className="btn">Stop</Post> : gate?.secondary ? <a className="btn" href="#changes">{gate.secondary}</a> : null
  return (
    <div className="actionbar" data-testid="action-bar" role="region" aria-label="Next step">
      <p className="sentence">{gate ? gate.sentence(ctx) : idle}</p>
      {gate && (
        <div className="actions">
          <a className="link small" href="#details">Show details</a>
          {secondary}
          {primary}
        </div>
      )}
    </div>
  )
}
