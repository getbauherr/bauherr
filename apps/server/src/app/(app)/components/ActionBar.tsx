import type { ReactNode } from 'react'
import { acceptStagingAction, approvePlanAction, backToBacklogAction, backToBuildAction, approveProductionAction, expediteAction, grantReviewRoundAction, rerunStage, stopReviewAction } from '../lib/actions'
import { GATES } from '../lib/gates'
import type { NextStep } from '../../../lib/next-step'
import type { Need } from '../lib/needs-you'
import { isWebUrl } from '../lib/url'
import { FormPending, NextStepBar, type NextStepPrimary } from './NextStepBar'
import { SubmitButton } from './SubmitButton'
import { Button } from './ui/button'

type Props = {
  ticket: number
  /** The Ticket's Product, for the "Configure checks" link. */
  product: number
  need: Need | null
  stage: string
  missing: string[]
  open: number
  /** Latest Run id, for the re-run action. */
  run: number | null
  /** Why the factory stopped (Run error or escalation Comment), part of the sentence. */
  reason?: string | null
  /** The disabled step shown when it is not the owner's turn: its reason is the bar's sentence and the button's tooltip. */
  idle: NextStep
  /** Workflow run of a failed release. */
  releaseRunUrl?: string | null
  /** The Product's staging site, linked next to Accept. */
  stagingUrl?: string | null
  /** The Ticket can still enter the Expedite lane (open, not flagged, before release); shows the Expedite button. */
  canExpedite?: boolean
}

const Post = ({ ticket, action, children, variant = 'default' }: { ticket: number; action: (f: FormData) => Promise<void>; children: string; variant?: 'default' | 'outline' }) => (
  <form action={action}>
    <input type="hidden" name="ticket" value={ticket} />
    <SubmitButton variant={variant}>{children}</SubmitButton>
  </form>
)

/** The one place the owner acts on a Ticket: same position in every state, one primary button. */
export function ActionBar({ ticket, product, need, stage, missing, open, run, reason, idle, releaseRunUrl, stagingUrl, canExpedite }: Props) {
  const gate = need ? GATES[need] : null
  const ctx = { stage, missing, open, reason }
  const verb = gate?.verb(ctx) ?? ''
  const fid = `bar-${ticket}`
  const post = (action: (f: FormData) => Promise<void>): { primary: NextStepPrimary; form: ReactNode } => ({
    primary: { label: verb, form: fid },
    form: <form id={fid} action={action}><input type="hidden" name="ticket" value={ticket} /><FormPending /></form>,
  })
  const step: { primary?: NextStepPrimary; form?: ReactNode } = !need ? {} : (() => {
    switch (need) {
      case 'Expedite?': return post(expediteAction)
      case 'Approve plan': return post(approvePlanAction)
      case 'Accept on staging':
      case 'Staging not confirmed': return post(acceptStagingAction)
      case 'Approve production':
      case 'Production deploy failed': return post(approveProductionAction)
      case 'Release failed': return releaseRunUrl ? { primary: { label: verb, href: releaseRunUrl, newTab: true } } : {}
      case 'Round cap reached': return post(grantReviewRoundAction)
      case 'Needs you': return {
        primary: { label: verb, form: fid },
        form: (
          <form id={fid} action={backToBuildAction}>
            <input type="hidden" name="ticket" value={ticket} />
            <input name="note" aria-label="Note for the next Run" placeholder="Note for the next Run (optional)" className="min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <FormPending />
          </form>
        ),
      }
      case 'Cancelled':
      case 'Run needs you':
      case 'Run failed': return run ? { primary: { label: verb, form: fid }, form: <form id={fid} action={rerunStage.bind(null, run)}><FormPending /></form> } : {}
      case 'Answer decisions':
      case 'Answer questions': return { primary: { label: `Answer ${open} question${open === 1 ? '' : 's'}`, href: '#answer' } }
      case 'Configure production checks': return { primary: { label: verb, href: `/settings/products/${product}#production` } }
    }
  })()
  const secondary = need === 'Round cap reached' ? <Post ticket={ticket} action={stopReviewAction} variant="outline">Stop</Post> : need === 'Cancelled' ? <Post ticket={ticket} action={backToBacklogAction} variant="outline">Back to backlog</Post> : gate?.secondary ? <Button asChild variant="outline"><a href="#changes">{gate.secondary}</a></Button> : null
  return (
    <NextStepBar sentence={gate ? gate.sentence(ctx) : idle.href ? <a className="text-primary" href={idle.href}>{idle.reason}</a> : idle.reason} primary={step.primary ?? (need ? undefined : { label: idle.label, disabled: true, reason: idle.reason })}>
      {(gate || canExpedite) && (
        <>
          {gate && gate.kind !== 'questions' && <a className="small text-primary" href="#details">Show details</a>}
          {gate?.kind === 'release' && isWebUrl(stagingUrl) && <a className="small text-primary" href={stagingUrl}>Open staging</a>}
          {secondary}
          {canExpedite && !secondary && need !== 'Expedite?' && <Post ticket={ticket} action={expediteAction} variant="outline">Expedite</Post>}
          {step.form}
        </>
      )}
    </NextStepBar>
  )
}
