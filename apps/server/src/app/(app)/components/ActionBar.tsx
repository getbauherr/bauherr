import { sendBackOptions } from '../../../lib/send-back-options'
import { SendBackDialog } from './SendBackDialog'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { acceptStagingAction, approvePlanAction, backToBuildAction, approveProductionAction, expediteAction, grantReviewRoundAction, rerunStage, stopReviewAction } from '../lib/actions'
import { hasSecondary } from '../lib/bar'
import { GATES } from '../lib/gates'
import { actionFor, fallbackFor, type Action, type NextStep } from '../../../lib/next-step'
import type { Need } from '../lib/needs-you'
import { isWebUrl } from '../lib/url'
import { ForgeLink } from './ForgeLink'
import { FormPending, LinkedReason, NextStepBar, type NextStepPrimary } from './NextStepBar'
import { SubmitButton } from './SubmitButton'
import { Button } from './ui/button'

type Props = {
  ticket: number
  product: number
  need: Need | null
  change?: string
  stage: string
  missing: string[]
  open: number
  run: number | null
  reason?: string | null
  idle: NextStep
  releaseRunUrl?: string | null
  stagingUrl?: string | null
  canExpedite?: boolean
  forge?: { href: string; label: string } | null
  ask?: string | null
}

const Post = ({ ticket, action, children, variant = 'default', title }: { ticket: number; action: (f: FormData) => Promise<void>; children: string; variant?: 'default' | 'outline'; title?: string }) => (
  <form action={action}>
    <input type="hidden" name="ticket" value={ticket} />
    <SubmitButton variant={variant} title={title}>{children}</SubmitButton>
  </form>
)

export const FAST_LANE_HELP = 'Skips Triage and plan approval, jumps the queue. One at a time.'

export function ActionBar({ ticket, product, need, stage, missing, open, run, reason, idle, releaseRunUrl, stagingUrl, canExpedite, ask, change, forge }: Props) {
  const gate = need ? GATES[need] : null
  const ctx = { stage, missing, open, reason, title: change }
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
        if (l.href === '#answer') return { node: <Button asChild data-testid="answer-questions"><Link href={`/tickets/${ticket}?view=conversation`}>{l.label ?? verb}</Link></Button> }
        return { primary: { label: l.label ?? verb, href: l.href, ...(l.newTab ? { newTab: true } : {}) } }
      }
    }
  })()
  const sendBack = sendBackOptions(need, gate?.kind)
  const secondary = need === 'Round cap reached' ? <Post ticket={ticket} action={stopReviewAction} variant="outline">Stop</Post> : sendBack.length ? <SendBackDialog ticket={ticket} options={sendBack} /> : gate?.secondary ? <Button asChild variant="outline"><a href="#changes">{gate.secondary}</a></Button> : null
  return (
    <NextStepBar live sentence={gate ? (ask ?? gate.sentence(ctx)) : <LinkedReason reason={idle.reason} links={idle.links} />} primary={step.primary ?? (need ? undefined : idle.href ? { label: idle.label, href: idle.href } : { label: idle.label, disabled: true, reason: idle.reason })}>
      {gate && gate.kind !== 'questions' && <a className="small text-primary" href="#details">Show details</a>}
      {gate?.kind === 'release' && isWebUrl(stagingUrl) && <a className="small text-primary" href={stagingUrl}>Open staging</a>}
      {forge && !hasSecondary({ need, canExpedite }) && <ForgeLink {...forge} />}
      {secondary}
      {canExpedite && !secondary && need !== 'Expedite?' && <Post ticket={ticket} action={expediteAction} variant="outline" title={FAST_LANE_HELP}>Put on the fast lane</Post>}
      {step.form}
      {step.node}
    </NextStepBar>
  )
}
