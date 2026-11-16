import { sendBackOptions } from '../../../lib/send-back-options'
import { GATES } from './gates'
import type { Need } from './needs-you'

/** Whether the bar shows a secondary button of its own (Stop, Send back, a gate's secondary, the fast lane); DESIGN.md allows one, so the forge link takes the slot only when this is false. */
export const hasSecondary = ({ need, canExpedite }: { need: Need | null; canExpedite?: boolean }): boolean => {
  const gate = need ? GATES[need] : null
  const secondary = need === 'Round cap reached' || sendBackOptions(need, gate?.kind).length > 0 || !!gate?.secondary
  return secondary || (!!canExpedite && need !== 'Expedite?')
}

/** Where the Ticket page shows its forge link: the bar's free secondary slot, else the CI panel header when the panel shows, else the Links section; never nowhere. */
export const forgeLinkSpot = (o: { need: Need | null; canExpedite?: boolean; ciPanel: boolean }): 'bar' | 'panel' | 'links' => (!hasSecondary(o) ? 'bar' : o.ciPanel ? 'panel' : 'links')
