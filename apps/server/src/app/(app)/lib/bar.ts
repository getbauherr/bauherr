import { actionFor } from '../../../lib/next-step'
import { sendBackOptions } from '../../../lib/send-back-options'
import { GATES } from './gates'
import type { Need } from './needs-you'

/** Whether the bar shows a secondary button of its own (Stop, Send back, a gate's secondary, the fast lane, Answer questions); DESIGN.md allows one, so the forge link takes the slot only when this is false. */
export const hasSecondary = ({ need, canExpedite, answerable = 0, run, open, product, releaseRunUrl }: { need: Need | null; canExpedite?: boolean; answerable?: number; run: number | null; open: number; product: number; releaseRunUrl?: string | null }): boolean => {
  const gate = need ? GATES[need] : null
  const action = need ? actionFor(need, { run, open, product, releaseRunUrl }) : null
  const answerNode = !!need && !!action && action.kind === 'link' && action.href === '#answer'
  const secondary = need === 'Round cap reached' || sendBackOptions(need, gate?.kind).length > 0 || !!gate?.secondary
  return secondary || (!!canExpedite && need !== 'Expedite?') || (answerable > 0 && !answerNode)
}
