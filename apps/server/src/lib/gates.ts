import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import { unansweredCriticalCount } from '../app/(app)/lib/plan'
import { type Need, needsYou } from './needs-you'
import { forgeOf, id } from './release'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const PLAN_GATES: (Need | null)[] = ['Approve plan', 'Answer decisions']

export const logins = (v: unknown): string[] => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** The Product's `gateOwners`, else the Admin Bauherren with a `githubLogin`. */
export const gateOwnersOf = async (payload: Payload, product: Doc): Promise<string[]> => {
  const listed = logins(product.gateOwners)
  if (listed.length) return listed
  const admins = await payload.find({ collection: 'bauherren', where: { and: [{ role: { equals: 'admin' } }, { githubLogin: { exists: true } }] }, pagination: false, ...o })
  return admins.docs.flatMap((a) => logins(a.githubLogin))
}

/**
 * Notifies the gate's person once per gate value: assigns them on the forge and posts one Comment that @mentions them (idempotent by marker).
 * A passed or changed gate releases the assignees the factory added, unless someone else holds the Ticket.
 */
export const syncGate = async (payload: Payload, t: Doc, run: { id: number | string; stage: string; status: string } | null): Promise<boolean> => {
  const base = t.state === 'closed' ? null : needsYou({ stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState }, run)
  const held: Need | null = t.gateNotified ?? null
  if (!base && !held) return false
  const { tickets } = await forgeOf(payload, id(t.product))
  let want = base
  if (base === 'Approve plan' && PLAN_GATES.includes(held)) want = held
  else if (base === 'Approve plan' && unansweredCriticalCount(await tickets.listComments(String(t.number)))) want = 'Answer decisions'
  if (want === held) return false
  const n = String(t.number)
  const mine = logins(t.gateAssignees)
  if (mine.length && (!t.assignee || mine.includes(t.assignee))) await tickets.release(n)
  const added: string[] = []
  if (want) {
    const product = await payload.findByID({ collection: 'products', id: id(t.product), ...o })
    const owners = await gateOwnersOf(payload, product)
    for (const login of owners.filter((l) => l !== t.assignee)) {
      try {
        await tickets.claim(n, login)
        added.push(login)
      } catch (e) {
        payload.logger.warn({ err: e, ticket: t.id, login }, 'gate assignee failed')
      }
    }
    if (owners.length) {
      const marker = `<!-- bauherr:gate:${want}:${createHash('sha1').update(`${want}${run?.id ?? ''}`).digest('hex')} -->`
      if (!(await tickets.listComments(n)).some((c) => c.body.startsWith(marker))) {
        await tickets.comment(n, `${marker}\n${owners.map((l) => `@${l}`).join(' ')}: ${want} — ${process.env.PUBLIC_URL ?? ''}/tickets/${t.id}`)
      }
    }
  }
  await payload.update({
    collection: 'tickets',
    id: t.id,
    data: { gateNotified: want, gateNotifiedAt: want ? new Date().toISOString() : null, gateAssignees: added.join(',') },
    ...o,
  })
  return true
}

/** Syncs the gate of every open Ticket and of closed ones still holding one; a failing Ticket does not stop the others. */
export const syncGates = async (payload: Payload): Promise<number> => {
  const tickets = (await payload.find({ collection: 'tickets', where: { or: [{ state: { equals: 'open' } }, { gateNotified: { exists: true } }] }, pagination: false, ...o })).docs as Doc[]
  if (!tickets.length) return 0
  const latest = new Map<number, Doc>()
  for (const r of (await payload.find({ collection: 'runs', where: { ticket: { in: tickets.map((t) => t.id) } }, sort: '-createdAt', pagination: false, ...o })).docs as Doc[]) {
    if (!latest.has(r.ticket)) latest.set(r.ticket, r)
  }
  let changed = 0
  for (const t of tickets) {
    try {
      if (await syncGate(payload, t, (latest.get(t.id) as { id: number; stage: string; status: string } | undefined) ?? null)) changed++
    } catch (e) {
      payload.logger.error({ err: e, ticket: t.id }, 'syncGate failed')
    }
  }
  return changed
}
