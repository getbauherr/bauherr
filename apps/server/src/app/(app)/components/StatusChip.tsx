const chips: Record<string, [cls: string, text: string]> = {
  queued: ['queued', 'Queued'],
  running: ['running', 'Running'],
  succeeded: ['succeeded', '✓ Succeeded'],
  failed: ['failed', '× Failed'],
  cancelled: ['cancelled', 'Cancelled'],
  needs_human: ['needs', 'Needs human'],
  awaiting_session: ['queued', 'Waiting for a session'],
  budget_exhausted: ['needs', 'Budget exhausted'],
  abandoned: ['cancelled', 'Abandoned'],
}

export function StatusChip({ status }: { status: string }) {
  const [cls, text] = chips[status] ?? chips.queued
  return (
    <span className={`chip label ${cls}`}>
      {cls === 'running' && <span className="spin" />}
      {text}
    </span>
  )
}
