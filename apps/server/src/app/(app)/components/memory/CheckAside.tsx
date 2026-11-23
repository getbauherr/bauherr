import type { ReactNode } from 'react'
import type { StatementRecord } from '../../../../core/views/statement-records'
import { shortDate } from '../../lib/format'
import { IssueRef } from './CheckState'

const CARD = 'grid gap-2 rounded-md border border-border bg-card p-4'

const evidenceOf = (count: number): string =>
  count === 0 ? '' : `, with the ${count === 1 ? 'ticket' : `${count} tickets`} it came back on as evidence`

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={CARD}>
      <h2 className="label m-0 text-muted-foreground">{title}</h2>
      <p className="small m-0">{children}</p>
    </div>
  )
}

export function CheckAside({ record, repo }: { record: StatementRecord; repo: string | null }) {
  const { check } = record
  return (
    <div className="grid content-start gap-4">
      {check.kind === 'building' && (
        <Note title="Check being built">
          <IssueRef check={check} /> prevents this by a check. Its Brief comes to you.
        </Note>
      )}
      {check.kind === 'since' && (
        <Note title="Check since">
          <IssueRef check={check} /> was accepted. This memory is no longer handed to runs. It is not deleted.
        </Note>
      )}
      {check.kind === 'discarded' && (
        <Note title="Check discarded">A check was proposed and discarded on {shortDate(check.at)}.</Note>
      )}
      {record.mayCheck && repo !== null && (
        <Note title="Make it a check">
          Opens a ticket in <span className="mono">{repo}</span>: prevent this by a test, a type or an API change
          {evidenceOf(record.cameBack)}. Its Brief comes to you. When it is done, this memory is no longer handed out.
        </Note>
      )}
    </div>
  )
}
