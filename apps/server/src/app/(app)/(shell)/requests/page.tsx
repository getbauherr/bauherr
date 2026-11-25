import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { FirstVisit } from '../../components/request/FirstVisit'
import { ProductPicker } from '../../components/request/ProductPicker'
import { RequestFilters } from '../../components/request/RequestFilters'
import { RequestRows } from '../../components/request/RequestRows'
import { Button } from '../../components/ui/button'
import {
  applyFilter,
  filterCounts,
  listRequests,
  REQUEST_FILTERS,
  type RequestFilter,
} from '../../../../core/views/request-status'
import { isBauherr, loginsOf } from '../../../../lib/people'
import { payloadClient } from '../../lib/session'
import { readableProducts, requestsOf, requireRequestsReader, sentRecordIdsOf } from '../../lib/requests'

export const dynamic = 'force-dynamic'

const filterOf = (value: string | undefined): RequestFilter =>
  REQUEST_FILTERS.find((f) => f === value) ?? 'open'

export default async function Requests({
  searchParams,
}: {
  searchParams?: Promise<{ product?: string; show?: string }>
}) {
  const person = await requireRequestsReader()
  const payload = await payloadClient()
  const products = await readableProducts(payload, person)
  const query = (await searchParams) ?? {}
  const product = products.find((p) => String(p.id) === query.product) ?? products[0]
  if (!product) {
    return (
      <>
        <h1 className="title">Requests</h1>
        <EmptyState text="Nobody has given you a Product yet. Ask your Bauherr to assign one." />
      </>
    )
  }
  const list = listRequests(await requestsOf(payload, product), {
    forgeLogins: loginsOf(person.githubLogin),
    sentRecordIds: await sentRecordIdsOf(payload, person.email),
  })
  const filter = filterOf(query.show)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Requests</h1>
        <ProductPicker products={products} current={product.id} />
        {list.length > 0 && (
          <Button asChild className="ml-auto">
            <Link href="/requests/new">New request</Link>
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <FirstVisit product={product.name} />
      ) : (
        <>
          <RequestFilters product={product.id} current={filter} counts={filterCounts(list)} />
          {applyFilter(list, filter).length === 0 ? (
            <p className="small text-muted-foreground">Nothing here.</p>
          ) : (
            <RequestRows list={applyFilter(list, filter)} staff={isBauherr(person)} />
          )}
        </>
      )}
    </>
  )
}
