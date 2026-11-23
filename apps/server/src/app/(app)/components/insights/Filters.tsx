import Link from 'next/link'
import { cn } from '@/lib/utils'
import { RANGES, type Range } from '../../../../core/views/insights-page'
import { insightsHref, RANGE_LABELS } from '../../lib/insights'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'

type Props = { days: Range; product: number | null; products: { id: number; name: string }[] }

const CHIP = cn(
  'inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

export function Filters({ days, product, products }: Props) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <nav aria-label="Range" className="flex items-center gap-2">
        {RANGES.map((value) => (
          <Link
            key={value}
            href={insightsHref(value, product)}
            aria-current={value === days ? 'true' : undefined}
            className={cn(CHIP, value === days && 'border-primary bg-accent')}
          >
            {RANGE_LABELS[value]}
          </Link>
        ))}
      </nav>
      {products.length > 1 && (
        <form action="/insights" method="get" className="flex items-center gap-2">
          <input type="hidden" name="days" value={days} />
          <label htmlFor="insights-product" className="small text-muted-foreground">Product</label>
          <NativeSelect id="insights-product" name="product" defaultValue={product ?? ''} className="h-8">
            <option value="">All</option>
            {products.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </NativeSelect>
          <Button type="submit" variant="outline" size="sm">Show</Button>
        </form>
      )}
    </div>
  )
}
