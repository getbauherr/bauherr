import { APPROVED_PLAN } from '@bauherr/adapters'
import type { LabelEvent } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { askedFor, speaksAs, voicesOf } from './forge-channel'
import { EXPEDITE_LABEL, EXPEDITE_SKIP_TOUCH } from './needs-you'
import { workflowFor } from './factory'
import { humanGates } from './mode'
import { gatesOf } from './staging'
import type { Workflow } from './workflow'
import { id } from './release'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export const APPROVED_STAGING = 'bauherr:approved:staging'

export const GATE_LABELS = [
  { gate: 'plan', label: APPROVED_PLAN, kind: 'approve:plan', recorded: ['approve:plan', 'approve:inherited'], strictWhenOff: true },
  { gate: 'staging', label: APPROVED_STAGING, kind: 'accept:staging', recorded: ['accept:staging', 'auto:staging', EXPEDITE_SKIP_TOUCH], strictWhenOff: true },
  { gate: 'expedite', label: EXPEDITE_LABEL, kind: 'expedite', recorded: ['expedite'], strictWhenOff: true },
] as const

export const gateIsOn = (wf: Workflow, gate: (typeof GATE_LABELS)[number]['gate']) => gate === 'expedite' || humanGates(wf).includes(gate)

export const TOUCH_WINDOW_MS = 10 * 60_000
const SKEW_MS = 60_000

export const REJECTED_MARKER = (label: string, at: string) => `<!-- bauherr:label-rejected:${label}:${at} -->`

interface Forge {
  labelEvents(id: string): Promise<LabelEvent[]>
  whoami(): Promise<string | null>
  removeLabels(id: string, labels: string[]): Promise<void>
  listComments(id: string): Promise<{ body: string }[]>
  comment(id: string, body: string): Promise<unknown>
}

export interface GateVerdict {
  accepted: string[]
  rejected: string[]
  pending: string[]
}

export const verifyGateLabels = async (payload: Payload, ticket: Doc, labels: string[], ts: Forge, gates: readonly (typeof GATE_LABELS)[number][] = GATE_LABELS): Promise<GateVerdict> => {
  const verdict: GateVerdict = { accepted: [], rejected: [], pending: [] }
  const wf = workflowFor(ticket.workspace)
  const mine = (await gatesOf(payload, wf, ticket)) ?? humanGates(wf)
  const gateIsOn = (_: Workflow, gate: (typeof GATE_LABELS)[number]['gate']) => gate === 'expedite' || mine.includes(gate)
  const inPlay = gates.filter((g) => labels.includes(g.label))
  verdict.accepted.push(...inPlay.filter((g) => !g.strictWhenOff && !gateIsOn(wf, g.gate)).map((g) => g.label))
  const present = inPlay.filter((g) => g.strictWhenOff || gateIsOn(wf, g.gate))
  if (!present.length) return verdict
  const n = String(ticket.number)
  let events: LabelEvent[]
  let me: string | null
  try {
    ;[events, me] = await Promise.all([ts.labelEvents(n), ts.whoami()])
  } catch (e) {
    payload.logger.warn({ err: e, ticket: ticket.id }, 'gate label events unavailable')
    verdict.pending.push(...present.map((g) => g.label))
    return verdict
  }
  const voices = await voicesOf(payload, ticket)
  for (const g of present) {
    const ev = events.filter((e) => e.label === g.label && e.action === 'labeled').at(-1)
    if (!ev?.actor) {
      verdict.pending.push(g.label)
      continue
    }
    const actor = ev.actor.toLowerCase()
    const factory = me === null ? actor.endsWith('[bot]') : actor === me.toLowerCase()
    const at = Date.parse(ev.at)
    const touched = (await payload.count({
      collection: 'human_touches',
      where: { and: [{ ticket: { equals: ticket.id } }, { kind: { in: [...g.recorded] } }, { at: { greater_than_equal: new Date(at - TOUCH_WINDOW_MS).toISOString() } }, { at: { less_than_equal: new Date(at + SKEW_MS).toISOString() } }] },
      ...o,
    })).totalDocs > 0
    const on = gateIsOn(wf, g.gate)
    const as = factory ? null : speaksAs(voices, actor)
    const asked = g.gate === 'expedite' ? 'bauherr' : askedFor(ticket, g.gate === 'plan' ? 'Approve plan' : 'Accept on staging', voices)
    if (factory ? touched : on && (as === 'bauherr' || (as === 'product-owner' && asked === 'product-owner'))) {
      verdict.accepted.push(g.label)
      if (!factory && !touched) {
        await payload.create({ collection: 'human_touches', data: { kind: g.kind, ticket: ticket.id, workspace: id(ticket.workspace), actor: ev.actor, at: ev.at }, ...o })
      }
      continue
    }
    verdict.rejected.push(g.label)
    await ts.removeLabels(n, [g.label])
    const marker = REJECTED_MARKER(g.label, ev.at)
    if (!(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) {
      await ts.comment(n, `${marker}\nBauherr removed \`${g.label}\`: ${on ? `it was set by ${ev.actor}, whose forge login is not linked to a Bauherr or Admin of this Workspace or, where this gate asks the Product owner, to a Product owner assigned to this Product. Link your login on your profile or use the ${g.gate === 'expedite' ? 'Expedite' : 'Approve'} button on the Ticket page.` : `the ${g.gate} gate is off, so the label approves nothing.`}`)
    }
  }
  return verdict
}
