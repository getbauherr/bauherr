import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { Card } from './ui/card'

/** "Edit" disclosure that opens as a drawer at the right edge of the viewport. */
export function EditDrawer({ children }: { children: ReactNode }) {
  return (
    <details className="open:fixed open:inset-y-0 open:right-0 open:z-20 open:w-[min(420px,100%)] open:overflow-auto open:border-l open:border-border open:bg-card [&[open]>summary]:m-4">
      <Button asChild variant="outline">
        <summary className="list-none [&::-webkit-details-marker]:hidden">Edit</summary>
      </Button>
      <Card className="gap-4">{children}</Card>
    </details>
  )
}
