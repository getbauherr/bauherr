import type { Check, Forge, TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { id, latestChecks, passed } from './release'

type Doc = Record<string, any>
type Ctx = { backend: { forge: Forge }; repo: string; tickets: TicketSource }
const o = { overrideAccess: true, depth: 0 } as const

/**
 * A failed required check is re-run once per (Ticket, sha, check) before it counts. `check_flakes` holds one row per retry and is the once-only guard.
 * `retried` = a re-run is under way (or the old failure is still listed): wait. `exhausted` = retries off, already retried, or the forge cannot re-run: today's behaviour.
 */
export const retryRed = async (payload: Payload, t: Doc, product: Doc, ctx: Ctx, sha: string, failed: Check[]): Promise<'retried' | 'exhausted'> => {
  if (!((product.checkRetries ?? 1) > 0)) return 'exhausted'
  const rows = (await payload.find({ collection: 'check_flakes', where: { ticket: { equals: t.id }, sha: { equals: sha } }, pagination: false, ...o })).docs as Doc[]
  const waiting = failed.some((c) => rows.some((r) => r.checkName === c.name && r.outcome === 'pending' && r.checkId === c.id))
  const claimed: { c: Check; row: Doc }[] = []
  for (const c of failed.filter((c) => !rows.some((r) => r.checkName === c.name))) {
    const row = await payload.create({ collection: 'check_flakes', data: { workspace: id(t.workspace), ticket: t.id, checkName: c.name, checkId: c.id, sha, runUrl: c.url }, ...o } as never).catch(() => null)
    if (row) claimed.push({ c, row: row as Doc })
  }
  if (!claimed.length) return waiting ? 'retried' : 'exhausted'
  const rerun = await ctx.backend.forge.rerunFailed(ctx.repo, claimed.map((x) => x.c)).catch((err) => (payload.logger.warn({ err, ticket: t.id }, 're-running the failed checks failed'), false))
  if (!rerun) {
    await Promise.all(claimed.map((x) => payload.delete({ collection: 'check_flakes', id: x.row.id, ...o })))
    return waiting ? 'retried' : 'exhausted'
  }
  for (const { c } of claimed) await ctx.tickets.comment(String(t.number), `Bauherr: check \`${c.name}\` failed on \`${sha.slice(0, 7)}\`, retried once.${c.url ? ` ${c.url}` : ''}`)
  return 'retried'
}

/** Settles the `pending` retries of (Ticket, sha) once their check has a newer finished run: passed = `flake`, failed again = `failed`. Safe to call on every gate pass. */
export const settleRetries = async (payload: Payload, t: Doc, sha: string, checks: Check[]): Promise<void> => {
  const rows = (await payload.find({ collection: 'check_flakes', where: { ticket: { equals: t.id }, sha: { equals: sha }, outcome: { equals: 'pending' } }, pagination: false, ...o })).docs as Doc[]
  const latest = latestChecks(checks)
  for (const r of rows) {
    const c = latest.find((x) => x.name === r.checkName)
    if (c?.status === 'completed' && c.id !== r.checkId) await payload.update({ collection: 'check_flakes', id: r.id, data: { outcome: passed(c) ? 'flake' : 'failed' }, ...o })
  }
}
