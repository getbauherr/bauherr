import type { ReactNode } from 'react'
import { acceptStagingAction, approvePlanAction, backToBacklogAction, backToBuildAction, approveProductionAction, expediteAction, grantReviewRoundAction, rerunStage, stopReviewAction } from '../lib/actions'
import { GATES } from '../lib/gates'
import { actionFor, fallbackFor, type Action, type NextStep } from '../../../lib/next-step'
import type { Need } from '../lib/needs-you'
import { isWebUrl } from '../lib/url'
import { DockOpen } from './chat/DockOpen'
import { FormPending, LinkedReason, NextStepBar, type NextStepPrimary } from './NextStepBar'
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
  /** The prepared Decision's ask: the bar's sentence, so the Inbox and this page say the same. */
  ask?: string | null
  /** Open owner questions that can be answered now (the decision sheet while the plan is not approved); an outline button next to the primary opens the docked chat on them. */
  answerable?: number
}

const Post = ({ ticket, action, children, variant = 'default' }: { ticket: number; action: (f: FormData) => Promise<void>; children: string; variant?: 'default' | 'outline' }) => (
  <form action={action}>
    <input type="hidden" name="ticket" value={ticket} />
    <SubmitButton variant={variant}>{children}</SubmitButton>
  </form>
)

/** The one place the owner acts on a Ticket: same position in every state, one primary button. */
export function ActionBar({ ticket, product, need, stage, missing, open, run, reason, idle, releaseRunUrl, stagingUrl, canExpedite, ask, answerable = 0 }: Props) {
  const gate = need ? GATES[need] : null
  const ctx = { stage, missing, open, reason }
  const verb = gate?.verb(ctx) ?? ''
  const fid = `bar-${ticket}`
  const post = (action: (f: FormData) => Promise<void>): { primary: NextStepPrimary; form: ReactNode } => ({
    primary: { label: verb, form: fid },
    form: <form id={fid} action={action}><input type="hidden" name="ticket" value={ticket} /><FormPending /></form>,
  })
  const action = need ? actionFor(need, { run, open, product, releaseRunUrl }) : null
  const fallback = need && !action ? fallbackFor(need) : null
  const step: { primary?: NextStepPrimary; form?: ReactNode; node?: ReactNode } = !need ? {} : fallback ? { primary: { label: fallback.label, href: fallback.href } } : (() => {
    switch (action!.kind) {
      case 'expedite': return post(expediteAction)
      case 'approvePlan': return post(approvePlanAction)
      case 'acceptStaging': return post(acceptStagingAction)
      case 'approveProduction': return post(approveProductionAction)
      case 'grantRound': return post(grantReviewRoundAction)
      case 'backToBuild': return {
        primary: { label: verb, form: fid },
        form: (
          <form id={fid} action={backToBuildAction}>
            <input type="hidden" name="ticket" value={ticket} />
            <input name="note" aria-label="Note for the next Run" placeholder="Note for the next Run (optional)" className="min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <FormPending />
          </form>
        ),
      }
      case 'rerun': return { primary: { label: verb, form: fid }, form: <form id={fid} action={rerunStage.bind(null, run!)}><FormPending /></form> }
      case 'link': {
        const l = action as Extract<Action, { kind: 'link' }>
        if (l.href === '#answer') return { node: <DockOpen ticket={ticket} mode="answer">{l.label ?? verb}</DockOpen> }
        return { primary: { label: l.label ?? verb, href: l.href, ...(l.newTab ? { newTab: true } : {}) } }
      }
    }
  })()
  const secondary = need === 'Round cap reached' ? <Post ticket={ticket} action={stopReviewAction} variant="outline">Stop</Post> : need === 'Cancelled' ? <Post ticket={ticket} action={backToBacklogAction} variant="outline">Back to backlog</Post> : gate?.secondary ? <Button asChild variant="outline"><a href="#changes">{gate.secondary}</a></Button> : null
  return (
    <NextStepBar sentence={gate ? (ask ?? gate.sentence(ctx)) : <LinkedReason reason={idle.reason} links={idle.links} />} primary={step.primary ?? (need ? undefined : idle.href ? { label: idle.label, href: idle.href } : { label: idle.label, disabled: true, reason: idle.reason })}>
      {gate && gate.kind !== 'questions' && <a className="small text-primary" href="#details">Show details</a>}
      {gate?.kind === 'release' && isWebUrl(stagingUrl) && <a className="small text-primary" href={stagingUrl}>Open staging</a>}
      {secondary}
      {canExpedite && !secondary && need !== 'Expedite?' && <Post ticket={ticket} action={expediteAction} variant="outline">Expedite</Post>}
      {answerable > 0 && !step.node && <DockOpen ticket={ticket} mode="answer" variant="outline">Answer {answerable} question{answerable === 1 ? '' : 's'}</DockOpen>}
      <DockOpen ticket={ticket} mode="comment" variant="outline">Comment</DockOpen>
      {step.form}
      {step.node}
    </NextStepBar>
  )
}
