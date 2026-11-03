import { Badge } from './ui/badge'

type Variant = 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'destructive'

const chips: Record<string, [variant: Variant, text: string]> = {
  queued: ['neutral', 'Queued'],
  running: ['accent', 'Running'],
  succeeded: ['ok', '✓ Succeeded'],
  failed: ['destructive', '× Failed'],
  cancelled: ['muted', 'Cancelled'],
  needs_human: ['warn', 'Needs human'],
  awaiting_session: ['neutral', 'Waiting for a session'],
  budget_exhausted: ['warn', 'Budget exhausted'],
  abandoned: ['muted', 'Abandoned'],
}

export function StatusChip({ status }: { status: string }) {
  const [variant, text] = chips[status] ?? chips.queued
  return (
    <Badge variant={variant}>
      {variant === 'accent' && <span className="size-3 animate-[spin_1.6s_linear_infinite] rounded-full border-[1.5px] border-border border-t-primary motion-reduce:animate-none" />}
      {text}
    </Badge>
  )
}
