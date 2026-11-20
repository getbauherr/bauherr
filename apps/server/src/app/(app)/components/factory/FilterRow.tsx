import Link from 'next/link'
import { cn } from '@/lib/utils'
import { filterHref, SHOW_LABELS, SHOWS, type Show } from '../../lib/factory'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'

type Props = {
  show: Show
  product?: number | undefined
  counts: Record<Show, number>
  products: { id: number; name: string }[]
}

const CHIP = cn(
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

export function FilterRow({ show, product, counts, products }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Filter tickets" className="flex flex-wrap items-center gap-2">
        {SHOWS.map((value) => (
          <Link
            key={value}
            href={filterHref(value, product)}
            scroll={false}
            aria-current={value === show ? 'true' : undefined}
            className={cn(CHIP, value === show && 'border-primary bg-accent')}
          >
            {SHOW_LABELS[value]} <span className="mono text-muted-foreground">{counts[value]}</span>
          </Link>
        ))}
      </nav>
      {products.length > 1 && (
        <form action="/" method="get" className="ml-auto flex items-center gap-2">
          {show !== 'all' && <input type="hidden" name="show" value={show} />}
          <label htmlFor="factory-product" className="small text-muted-foreground">Product</label>
          <NativeSelect id="factory-product" name="product" defaultValue={product ?? ''} className="h-8">
            <option value="">All</option>
            {products.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </NativeSelect>
          <Button type="submit" variant="outline" size="sm">Show</Button>
        </form>
      )}
    </div>
  )
}
