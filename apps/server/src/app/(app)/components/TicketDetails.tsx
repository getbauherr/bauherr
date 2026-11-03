import type { ReactNode } from 'react'

/** The one closed disclosure of the Ticket page. The id sits on the content, so a `#details` link opens it natively. */
export function TicketDetails({ children }: { children: ReactNode }) {
  return (
    <details>
      <summary className="label w-fit cursor-pointer text-muted-foreground">Details</summary>
      <div id="details" className="mt-4 flex scroll-mt-[calc(72px+var(--space-4))] flex-col gap-6">{children}</div>
    </details>
  )
}
