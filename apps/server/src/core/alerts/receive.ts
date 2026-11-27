import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { Conn } from '../conn'
import type { ForgeWriter } from '../forge/writer'
import { createRecord, setRank } from '../record/store'
import { sourceOf } from '../requests/send'
import { fingerprintHash, type Alert, type Severity } from './parse'
import { alertTicketCount, openAlertTicket } from './store'
import { commentBody, issueBody, issueTitle } from './text'

export type AlertDeps = { writer: Pick<ForgeWriter, 'openIssue' | 'commentOnIssue'> }
export type AlertOutcome = 'opened' | 'commented' | 'ignored'

export const RANK_BY_SEVERITY: Record<Severity, number> = { critical: -2, high: -1, normal: 0 }
export const ALERT_REPORTER = 'production alert'

export const receiveAlert = async (
  payload: Payload,
  deps: AlertDeps,
  where: { workspace: number; product: number },
  alert: Alert,
): Promise<AlertOutcome> => {
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
