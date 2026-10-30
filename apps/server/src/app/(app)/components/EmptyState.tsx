import Link from 'next/link'

export function EmptyState({ text, action }: { text: string; action: { href: string; label: string } }) {
  return (
    <div className="empty">
      <p className="body">{text}</p>
      <Link href={action.href} className="btn">
        {action.label}
      </Link>
    </div>
  )
}
