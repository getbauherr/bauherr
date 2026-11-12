'use client'
import { ClipboardCheckIcon } from 'lucide-react'
import type { FC } from 'react'
import { ApprovalCard } from '../assistant-ui/elements/approval-card'
import { CodeDiff } from '../assistant-ui/elements/code-diff'
import type { Summary } from '../../../../lib/refine/engine'

/** The end of the conversation: what was decided, the Ticket text as a diff, what happens next. One decision: send it on (or keep refining). */
export const SummaryCard: FC<{ summary: Summary; sent: boolean; busy: boolean; onSend(): void; onKeep(): void }> = ({ summary, sent, busy, onSend, onKeep }) => {
  const diff = summary.diff ?? []
  return (
    <div className="flex flex-col gap-3" data-testid="refine-summary">
      {(summary.diff || summary.title) && (
        <CodeDiff
          filename="Ticket text"
          additions={diff.filter((l) => l.kind === 'added').length + (summary.title ? 1 : 0)}
          deletions={diff.filter((l) => l.kind === 'removed').length + (summary.title ? 1 : 0)}
          lines={[...(summary.title ? [{ kind: 'removed' as const, text: `Title: ${summary.title.from}` }, { kind: 'added' as const, text: `Title: ${summary.title.to}` }] : []), ...diff]}
          cycle={0}
          className="max-w-none"
        />
      )}
      <ApprovalCard
        className="max-w-none"
        state={sent ? 'done' : busy ? 'running' : 'request'}
        title={sent ? 'Sent to planning' : 'Everything is decided'}
        subtitle={`${summary.decided.filter((d) => !d.dropped).length} answered, ${summary.decided.filter((d) => d.dropped).length} no longer needed`}
        description={`What happens next: ${summary.next}`}
        details={summary.decided.map((d) => ({ label: d.id, value: d.dropped ? `${d.title}: no longer needed` : `${d.title}: ${d.answer}` }))}
        icon={<ClipboardCheckIcon className="size-4" />}
        allowOnceLabel="Send to planning"
        denyLabel="Keep refining"
        statusLabel={sent ? 'Sent to planning' : 'Sending'}
        onAllowOnce={sent ? undefined : onSend}
        onDeny={sent ? undefined : onKeep}
      />
    </div>
  )
}
