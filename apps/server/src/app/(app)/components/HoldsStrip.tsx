import Link from 'next/link'
import type { Hold } from '../../../lib/holds'

export function HoldsStrip({ holds }: { holds: Pick<Hold, 'text' | 'href' | 'waiting' | 'causes'>[] }) {
  if (!holds.length) return null
  return (
    <section aria-labelledby="holds-title" data-testid="holds-strip" className="border-b border-border bg-card px-4 py-2 max-sm:px-2">
      <h2 id="holds-title" className="small font-medium text-warn">Holding up work</h2>
      <ul className="small flex flex-col gap-0.5">
        {holds.map((h) => (
          <li key={h.href + h.text}>
            <Link className="text-primary" href={h.href}>{h.text}</Link>
            <span className="text-muted-foreground"> {h.waiting.length} waiting</span>
            {h.causes && (
              <ul className="ml-4 list-disc">
                {h.causes.map((c) => (
                  <li key={c.stage}>
                    {c.stage}: {c.line}.{' '}
                    {c.action && <Link className="text-primary underline" href={c.action.href}>{c.action.label}</Link>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
