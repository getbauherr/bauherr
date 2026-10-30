import { createHash } from 'node:crypto'
import type { Payload } from 'payload'
import { unansweredCriticalCount } from '../app/(app)/lib/plan'
import { type Need, needsYou } from './needs-you'
import { publicUrl } from './oidc'
import { forgeOf, id } from './release'

type Doc = Record<string, any>
const o = { overrideAccess: true, depth: 0 } as const
const PLAN_GATES: (Need | null)[] = ['Approve plan', 'Answer decisions']

export const logins = (v: unknown): string[] => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** The Product's `gateOwners`, else the Admin Bauherren with a `githubLogin` (Admins are not tenant-scoped: they see every Workspace, so there is no narrower membership). */
export const gateOwnersOf = async (payload: Payload, product: Doc): Promise<string[]> => {
  const listed = logins(product.gateOwners)
  if (listed.length) return listed
  const admins = await payload.find({ collection: 'bauherren', where: { and: [{ role: { equals: 'admin' } }, { githubLogin: { exists: true } }] }, pagination: false, ...o })
  return admins.docs.flatMap((a) => logins(a.githubLogin))
}

/**
 * Notifies the gate's person once per gate value: assigns them on the forge and posts one Comment that @mentions them (idempotent by marker).
 * `gateNotified` is only set once every owner is assigned (or already was), so failed claims are retried each minute.
 * A passed or changed gate unassigns exactly the logins the factory added (`gateAssignees`); other assignees stay.
 * Returns whether the Ticket row changed.
 */
export const syncGate = async (payload: Payload, t: Doc, run: { id: number | string; stage: string; status: string } | null): Promise<boolean> => {
  const base = t.state === 'closed' ? null : needsYou({ stage: t.stage, labels: t.labels ?? [], releaseState: t.releaseState }, run)
  const held: Need | null = t.gateNotified ?? null
  const mine = logins(t.gateAssignees)
  if (!base && !held && !mine.length) return false
  let forge: ReturnType<typeof forgeOf> | undefined
  const source = async () => (await (forge ??= forgeOf(payload, id(t.product)))).tickets
  let want = base
  if (base === 'Approve plan' && PLAN_GATES.includes(held)) want = held
  else if (base === 'Approve plan' && unansweredCriticalCount(await (await source()).listComments(String(t.number)))) want = 'Answer decisions'
  if (want === held && (want || !mine.length)) return false
  const n = String(t.number)
  let added = mine
  if (mine.length && (held || !want)) {
    await (await source()).unassign(n, mine)
    added = []
  }
  let owners: string[] = []
  let complete = false
  if (want) {
    owners = await gateOwnersOf(payload, await payload.findByID({ collection: 'products', id: id(t.product), ...o }))
    const ts = await source()
    const assigned = logins(t.assignees)
    added = [...added]
    for (const login of owners.filter((l) => !assigned.includes(l) && !added.includes(l))) {
      try {
        await ts.claim(n, login)
        added.push(login)
      } catch (e) {
        payload.logger.warn({ err: e, ticket: t.id, login }, 'gate assignee failed')
      }
    }
    complete = owners.length > 0 && owners.every((l) => assigned.includes(l) || added.includes(l))
    if (owners.length) {
      const marker = `<!-- bauherr:gate:${want}:${createHash('sha1').update(`${want}${run?.id ?? ''}`).digest('hex')} -->`
      if (!(await ts.listComments(n)).some((c) => c.body.startsWith(marker))) {
        await ts.comment(n, `${marker}\n${owners.map((l) => `@${l}`).join(' ')}: ${want} — ${publicUrl()}/tickets/${t.id}`)
      }
    }
  }
  const notified = complete ? want : null
  if (notified === held && added.join(',') === mine.join(',')) return false
  await payload.update({
    collection: 'tickets',
    id: t.id,
    data: { gateNotified: notified, gateNotifiedAt: notified === held ? t.gateNotifiedAt : notified ? new Date().toISOString() : null, gateAssignees: added.join(',') },
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
