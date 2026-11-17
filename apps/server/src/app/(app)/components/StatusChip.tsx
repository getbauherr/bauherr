import { Clock } from './icons'
import { Badge } from './ui/badge'

type Variant = 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'destructive'

const chips: Record<string, [variant: Variant, text: string]> = {
  queued: ['neutral', 'Queued'],
  running: ['accent', 'Running'],
  succeeded: ['ok', '✓ Succeeded'],
  failed: ['destructive', '× Failed'],
  cancelled: ['muted', 'Cancelled'],
  needs_human: ['warn', 'Waiting for you'],
  awaiting_session: ['neutral', 'Waiting for a session'],
  budget_exhausted: ['warn', 'Budget exhausted'],
  abandoned: ['muted', 'Abandoned'],
}

/** `label` replaces the text ('Building' for a running Run), `tone` the colour; `clock` adds the clock glyph of a wait. A derived state (Run page) passes all three; the spinner shows on the accent tone only. */
export function StatusChip({ status, reason, label, tone, clock }: { status: string; reason?: string | null; label?: string; tone?: Variant; clock?: boolean }) {
  const [base, text] = chips[status] ?? chips.queued
  const variant = tone ?? base
  return (
    <Badge variant={variant} title={status === 'needs_human' && reason ? reason : undefined}>
      {variant === 'accent' && <span className="size-3 animate-[spin_1.6s_linear_infinite] rounded-full border-[1.5px] border-border border-t-primary motion-reduce:animate-none" />}
      {clock && <Clock className="size-3" />}
      {label ?? text}
    </Badge>
  )
}
