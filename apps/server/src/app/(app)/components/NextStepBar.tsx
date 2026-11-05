import type { ReactNode } from 'react'

/** The frame of the one place the owner acts on a page: sentence left, actions right, sticky at the top on desktop, fixed to the bottom at 640px and below. `main` pads for it via the test id. */
export function NextStepBar({ sentence, children }: { sentence: ReactNode; children?: ReactNode }) {
  return (
    <div
      className="sticky top-0 z-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-md border border-border bg-card px-4 py-3 text-card-foreground max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:flex-col max-sm:items-stretch max-sm:rounded-none max-sm:border-0 max-sm:border-t max-sm:pb-[calc(var(--space-3)+env(safe-area-inset-bottom))] [&_form]:contents"
      data-testid="action-bar"
      role="region"
      aria-label="Next step"
    >
      <p className="min-w-0 flex-[1_1_20ch] text-pretty">{sentence}</p>
      {children}
    </div>
  )
}
