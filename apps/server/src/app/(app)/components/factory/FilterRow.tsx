import Link from 'next/link'
import { cn } from '@/lib/utils'
import { RELATION_FILTERS, RELATION_LABELS, type BoardView, type RelationFilter } from '../../lib/board-relations'
import { filterHref, SHOW_LABELS, SHOWS, type Show } from '../../lib/factory'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'
import { Input } from '../ui/input'

type Props = {
  show: Show
  product?: number | undefined
  counts: Record<Show, number>
  products: { id: number; name: string }[]
  view: BoardView
  relationCounts: Record<RelationFilter, number>
}

const CHIP = cn(
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5',
  'outline-none focus-visible:ring-2 focus-visible:ring-ring',
)

export function FilterRow({ show, product, counts, products, view, relationCounts }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Filter tickets" className="flex flex-wrap items-center gap-2">
        {SHOWS.map((value) => (
          <Link
            key={value}
            href={filterHref(value, product, view)}
            scroll={false}
            aria-current={value === show ? 'true' : undefined}
            className={cn(CHIP, value === show && 'border-primary bg-accent')}
          >
            {SHOW_LABELS[value]} <span className="mono text-muted-foreground">{counts[value]}</span>
          </Link>
        ))}
      </nav>
      <nav aria-label="Relations" className="flex flex-wrap items-center gap-2">
        {RELATION_FILTERS.map((value) => {
          const active = view.relation === value
          return (
            <Link
              key={value}
              href={filterHref(show, product, { ...view, relation: active ? undefined : value })}
              scroll={false}
              aria-current={active ? 'true' : undefined}
              className={cn(CHIP, active && 'border-primary bg-accent')}
            >
              {RELATION_LABELS[value]} <span className="mono text-muted-foreground">{relationCounts[value]}</span>
            </Link>
          )
        })}
        <Link
          href={filterHref(show, product, { ...view, group: !view.group })}
          scroll={false}
          aria-current={view.group ? 'true' : undefined}
          className={cn(CHIP, view.group && 'border-primary bg-accent')}
        >
          Group by parent
        </Link>
      </nav>
      {products.length > 1 && (
        <form action="/" method="get" className="ml-auto flex items-center gap-2">
          {show !== 'all' && <Input type="hidden" name="show" value={show} />}
          {view.relation && <Input type="hidden" name="relation" value={view.relation} />}
          {view.group && <Input type="hidden" name="group" value="parent" />}
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
