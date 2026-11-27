'use client'
import { AssistantMessage } from '../assistant-ui/elements/thread-assistant'

export function FactoryMessage() {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
      <span aria-hidden className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-primary">
        <svg width="16" height="16" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="var(--on-accent)" strokeWidth="2.5" />
          <rect x="12" y="12" width="9" height="9" rx="2" fill="var(--on-accent)" />
        </svg>
      </span>
      <div className="min-w-0 [&_[data-slot$=message-footer]]:hidden">
        <p className="mono text-muted-foreground px-2">Factory</p>
        <AssistantMessage />
      </div>
    </div>
  )
}
