import { sendBackOptions } from '../../../lib/send-back-options'
import { GATES } from './gates'
import type { Need } from './needs-you'

export const hasSecondary = ({ need, canExpedite }: { need: Need | null; canExpedite?: boolean }): boolean => {
  const gate = need ? GATES[need] : null
  const secondary = need === 'Round cap reached' || sendBackOptions(need, gate?.kind).length > 0 || !!gate?.secondary
  return secondary || (!!canExpedite && need !== 'Expedite?')
}

export const forgeLinkSpot = (o: { need: Need | null; canExpedite?: boolean; ciPanel: boolean }): 'bar' | 'panel' | 'links' => (!hasSecondary(o) ? 'bar' : o.ciPanel ? 'panel' : 'links')
