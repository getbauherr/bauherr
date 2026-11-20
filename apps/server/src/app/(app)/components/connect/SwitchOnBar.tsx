import Link from 'next/link'
import type { ProductSettings } from '../../../../core/views/product-settings'
import { Button } from '../ui/button'
import { ProductStateForm } from '../product/ProductStateForm'

type Props = { product: ProductSettings; admin: boolean }

const BAR = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border px-4 py-3'

export function SwitchOnBar({ product, admin }: Props) {
  const factory = `/?product=${product.id}`
  if (product.state === 'active') {
    return (
      <div className={BAR}>
        <p role="status" className="min-w-0 flex-[1_1_20ch]">
          {product.name} is active. Nothing is built without your approval.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ProductStateForm product={product.id} state="active" />
          <Button asChild><Link href={factory}>Open the Factory view</Link></Button>
        </div>
      </div>
    )
  }
  return (
    <div className={BAR}>
      <p className="min-w-0 flex-[1_1_20ch]">
        Nothing is built without your approval. At most <span className="mono">{product.backlogBriefLimit}</span>{' '}
        Briefs wait on you at a time.
        {!admin && ' Only an Admin can switch a Product on.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline"><Link href={factory}>Show on the Factory view</Link></Button>
        {admin && <ProductStateForm product={product.id} state="observing" primary />}
      </div>
    </div>
  )
}
