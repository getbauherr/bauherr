import Link from 'next/link'
import { cn } from '@/lib/utils'
import { filterHref, SHOW_LABELS, SHOWS, type Show } from '../../lib/memory'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'

type Props = { show: Show; product: number; counts: Record<Show, number>; products: { id: number; name: string }[] }

const CHIP = cn(
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

export function MemoryFilters({ show, product, counts, products }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Filter memory" className="flex flex-wrap items-center gap-2">
        {SHOWS.map((value) => (
          <Link
            key={value}
            href={filterHref(value, product)}
            aria-current={value === show ? 'true' : undefined}
            className={cn(CHIP, value === show && 'border-primary bg-accent')}
          >
            {SHOW_LABELS[value]} <span className="mono text-muted-foreground">{counts[value]}</span>
          </Link>
        ))}
      </nav>
      <form action="/memory/statements" method="get" className="ml-auto flex items-center gap-2">
        {show !== 'all' && <input type="hidden" name="show" value={show} />}
        <label htmlFor="memory-product" className="small text-muted-foreground">Product</label>
        <NativeSelect id="memory-product" name="product" defaultValue={product} className="h-8">
          {products.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline" size="sm">Show</Button>
      </form>
    </div>
  )
}
