import Link from 'next/link'
import { Button } from './ui/button'

export function EmptyState({ text, action }: { text: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <p className="body">{text}</p>
      {action && (
        <Button asChild variant="outline">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  )
}
