import type { SomedayCount } from '../../../../core/views/someday'
import { somedayHref } from '../../lib/factory'

export function SomedayLine({ items }: { items: SomedayCount[] }) {
  if (!items.length) return null
  return (
    <p className="small text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${item.product}-${item.repo}`}>
          {index > 0 && ' · '}
          <a href={somedayHref(item)} className="text-primary underline underline-offset-2">
            Someday: {item.count}
          </a>
          {items.length > 1 && <span className="mono"> {item.repo}</span>}
        </span>
      ))}
    </p>
  )
}
