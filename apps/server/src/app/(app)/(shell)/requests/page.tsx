import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { FirstVisit } from '../../components/request/FirstVisit'
import { ProductSwitcher } from '../../components/request/ProductSwitcher'
import { RequestFilters } from '../../components/request/RequestFilters'
import { RequestRows } from '../../components/request/RequestRows'
import { Button } from '../../components/ui/button'
import type { RequestCursor } from '../../../../core/views/request-list'
import { REQUEST_FILTERS, type RequestFilter } from '../../../../core/views/request-status'
import { isBauherr } from '../../../../lib/people'
import { moreRequests } from './more-actions'
import { payloadClient } from '../../lib/session'
import {
  chosenProduct,
  readableProducts,
  requestChunk,
  requestTotals,
  requireRequestsReader,
  viewerOf,
} from '../../lib/requests'

export const dynamic = 'force-dynamic'

const filterOf = (value: string | undefined): RequestFilter =>
  REQUEST_FILTERS.find((f) => f === value) ?? 'open'

type Chunk = { list: unknown[]; cursor: RequestCursor | null }

const moreOf = (chunk: Chunk, product: number, show: RequestFilter, total: number) =>
  chunk.cursor
    ? { product, show, cursor: chunk.cursor, left: total - chunk.list.length, loadMore: moreRequests }
    : undefined

export default async function Requests({
  searchParams,
}: {
  searchParams?: Promise<{ product?: string; show?: string }>
}) {
  const person = await requireRequestsReader()
  const payload = await payloadClient()
  const products = await readableProducts(payload, person)
  const query = (await searchParams) ?? {}
  const product = await chosenProduct(products, query.product)
  if (!product) {
    return (
      <>
        <h1 className="title">Requests</h1>
        <EmptyState text="Nobody has given you a Product yet. Ask your Bauherr to assign one." />
      </>
    )
  }
  const viewer = await viewerOf(payload, person)
  const filter = filterOf(query.show)
  const [counts, chunk] = await Promise.all([
    requestTotals(payload, product, viewer),
    requestChunk(payload, { product, viewer, show: filter, after: null }),
  ])
  const total = counts.open + counts.live + counts.closed
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Requests</h1>
        <ProductSwitcher products={products} current={product.id} />
        {total > 0 && (
          <Button asChild className="ml-auto">
            <Link href={`/requests/new?product=${product.id}`}>New request</Link>
          </Button>
        )}
      </div>
      {total === 0 ? (
        <FirstVisit product={product.name} productId={product.id} />
      ) : (
        <>
          <RequestFilters product={product.id} current={filter} counts={counts} />
          {chunk.list.length === 0 ? (
            <p className="small text-muted-foreground">Nothing here.</p>
          ) : (
            <RequestRows
              list={chunk.list}
              staff={isBauherr(person)}
              more={moreOf(chunk, product.id, filter, counts[filter])}
            />
          )}
        </>
      )}
    </>
  )
}
