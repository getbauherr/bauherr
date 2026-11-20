import Link from 'next/link'
import type { ProductSettings } from '../../../../core/views/product-settings'
import { Card } from '../ui/card'

const LINK = 'small text-primary underline underline-offset-2'

export function RiskAreaList({ product }: { product: ProductSettings }) {
  const sets = Object.entries(product.pathSets).sort(([a], [b]) => a.localeCompare(b))
  return (
    <Card asChild>
      <section aria-labelledby="risk-areas">
        <h3 id="risk-areas" className="label text-muted-foreground">Suggested risk areas</h3>
        {sets.length === 0 && <p className="small text-muted-foreground">No path sets yet.</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {sets.map(([name, globs]) => (
            <li key={name} className="flex flex-col gap-1">
              <span>
                <span className="mono">{name}</span>{' '}
                <span className="small text-muted-foreground">
                  {product.riskAreas.includes(name) ? 'Risk area' : 'Not a risk area'}
                </span>
              </span>
              <span className="small mono text-muted-foreground wrap-anywhere">
                {globs.join(' · ') || 'no paths yet'}
              </span>
            </li>
          ))}
        </ul>
        <p className="small text-muted-foreground">A change in a risk area always gets a Brief for you to approve.</p>
        <Link href={`/settings/products/${product.id}#gates`} className={LINK}>
          Choose risk areas in Gates
        </Link>
      </section>
    </Card>
  )
}
