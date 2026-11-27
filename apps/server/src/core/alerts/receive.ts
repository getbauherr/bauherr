import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { Conn } from '../conn'
import type { ForgeWriter } from '../forge/writer'
import { createRecord, setRank } from '../record/store'
import { sourceOf } from '../requests/send'
import { fingerprintHash, type Alert, type Severity } from './parse'
import { alertTicketCount, openAlertTicket, recentAlertTickets } from './store'
import { commentBody, issueBody, issueTitle } from './text'

export type AlertDeps = { writer: Pick<ForgeWriter, 'openIssue' | 'commentOnIssue'> }
export type AlertOutcome = 'opened' | 'commented' | 'ignored'

export const RANK_BY_SEVERITY: Record<Severity, number> = { critical: -2, high: -1, normal: 0 }
export const ALERT_REPORTER = 'production alert'
export const NEW_TICKETS_PER_HOUR = 20
const STORM_HASH = fingerprintHash('alert-storm')

const stormOf = (alert: Alert): Alert => ({
  title: `More than ${NEW_TICKETS_PER_HOUR} new alerts in an hour`,
  description: `Not opened as tickets. Latest: ${alert.title}`,
  severity: 'high',
  fingerprint: 'alert-storm',
  url: null,
  resolved: false,
})

const receiveWithinCap = async (
  payload: Payload,
  deps: AlertDeps,
  where: { workspace: number; product: number },
  alert: Alert,
): Promise<AlertOutcome | 'capped'> => {
  const hash = fingerprintHash(alert.fingerprint)
  return payload.db.drizzle.transaction(async (tx) => {
    const db: Conn = { db: { drizzle: tx } }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('alert'), hashtext(${`${where.product}:${hash}`}))`)
    const open = await openAlertTicket(db, where.product, hash)
    if (open) {
      await deps.writer.commentOnIssue(where, open.number, commentBody(alert))
      return 'commented'
    }
    if (alert.resolved) return 'ignored'
    const recent = await recentAlertTickets(db, where.product, STORM_HASH, new Date())
    if (hash !== STORM_HASH && recent >= NEW_TICKETS_PER_HOUR) return 'capped'
    const earlier = await alertTicketCount(db, where.product, hash)
    const issue = await deps.writer.openIssue(where, {
      title: issueTitle(alert),
      body: issueBody(alert),
      reference: `bauherr-alert-${where.product}-${hash.slice(0, 16)}-${earlier}`,
    })
    const { kind, repo } = await sourceOf(db, where.workspace, where.product)
    const stored = await createRecord(db, {
      ...where,
      type: 'bug',
      source: {
        forge: kind,
        repo,
        number: issue.number,
        reporter: ALERT_REPORTER,
        external: true,
        backlog: false,
        alert: hash,
      },
    })
    await setRank(db, stored.id, RANK_BY_SEVERITY[alert.severity])
    return 'opened'
  })
}

export const receiveAlert = async (
  payload: Payload,
  deps: AlertDeps,
  where: { workspace: number; product: number },
  alert: Alert,
): Promise<AlertOutcome> => {
  const outcome = await receiveWithinCap(payload, deps, where, alert)
  return outcome === 'capped' ? receiveAlert(payload, deps, where, stormOf(alert)) : outcome
}
