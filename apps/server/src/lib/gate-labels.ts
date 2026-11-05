import { APPROVED_PLAN } from '@bauherr/adapters'
import type { LabelEvent } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { gateOwnersOf, logins } from './gates'
import { EXPEDITE_LABEL } from './needs-you'
import { humanGates } from './mode'
import { id } from './release'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const

export const APPROVED_STAGING = 'bauherr:approved:staging'

/** Labels that approve a human gate. Only a gate owner/Admin, or an approval the factory recorded itself, may set them; while a gate is off, a `strictWhenOff` label (staging: it would skip the production gate) counts only as the factory's own `auto:staging` path and is stripped otherwise; the plan label of an off gate is stripped as well (the factory writes it only while the gate is on; gate-off Tickets advance through `advancePlan`, which needs no label). */
export const GATE_LABELS = [
  { gate: 'plan', label: APPROVED_PLAN, kind: 'approve:plan', recorded: ['approve:plan', 'approve:inherited'], strictWhenOff: true },
  { gate: 'staging', label: APPROVED_STAGING, kind: 'accept:staging', recorded: ['accept:staging', 'auto:staging'], strictWhenOff: true },
  // The Expedite lane is not a gate, but its label skips Triage and the plan approval, so it is held to the same rule: a gate owner or Admin, or the factory's own Expedite action (`expedite` touch).
  { gate: 'expedite', label: EXPEDITE_LABEL, kind: 'expedite', recorded: ['expedite'], strictWhenOff: true },
] as const

/** Whether the workflow has the gate on (#175). */
export const gateIsOn = (gate: (typeof GATE_LABELS)[number]['gate']) => gate === 'expedite' || humanGates().includes(gate)

/** A recorded touch legitimises a factory-login label only when it was recorded shortly before the label event. */
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
  /** Actor unknown: neither approval nor removed; the next poll retries. */
  pending: string[]
}

/** Verifies every gate label in `labels` against the forge's label events (spec workflow.md, "Gate labels"). */
export const verifyGateLabels = async (payload: Payload, ticket: Doc, labels: string[], ts: Forge, gates: readonly (typeof GATE_LABELS)[number][] = GATE_LABELS): Promise<GateVerdict> => {
  const verdict: GateVerdict = { accepted: [], rejected: [], pending: [] }
  const inPlay = gates.filter((g) => labels.includes(g.label))
  verdict.accepted.push(...inPlay.filter((g) => !g.strictWhenOff && !gateIsOn(g.gate)).map((g) => g.label))
  const present = inPlay.filter((g) => g.strictWhenOff || gateIsOn(g.gate))
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
  const product = await payload.findByID({ collection: 'products', id: id(ticket.product), ...o })
  const admins = await payload.find({ collection: 'bauherren', where: { and: [{ role: { equals: 'admin' } }, { githubLogin: { exists: true } }] }, pagination: false, ...o })
  const owners = new Set([...(await gateOwnersOf(payload, product)), ...admins.docs.flatMap((a) => logins(a.githubLogin))].map((l) => l.toLowerCase()))
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
    const on = gateIsOn(g.gate)
    if (factory ? touched : on && owners.has(actor)) {
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
      await ts.comment(n, `${marker}\nBauherr removed \`${g.label}\`: ${on ? `it was set by ${ev.actor}, who is not a gate owner or Admin of this Product. Use the ${g.gate === 'expedite' ? 'Expedite' : 'Approve'} button on the Ticket page.` : `the ${g.gate} gate is off, so the label approves nothing.`}`)
    }
  }
  return verdict
}
