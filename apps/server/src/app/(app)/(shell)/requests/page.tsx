import Link from 'next/link'
import { EmptyState } from '../../components/EmptyState'
import { payloadClient } from '../../lib/session'
import { productsOf, requireProductOwner } from '../../lib/requests'

export const dynamic = 'force-dynamic'

export default async function Requests() {
  const user = await requireProductOwner()
  const products = await productsOf(await payloadClient(), user.assignments)
  return (
    <>
      <h1 className="title">Requests</h1>
      {products.length === 0 ? (
        <EmptyState text="Nobody has given you a Product yet. Ask your Bauherr to assign one." />
      ) : (
        products.map((product) => (
          <section key={product.id} aria-labelledby={`product-${product.id}`} className="flex flex-col gap-2">
            <h2 id={`product-${product.id}`} className="heading">
              {product.name}
            </h2>
            {product.requests.length === 0 ? (
              <p className="small text-muted-foreground">No requests yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y p-0 divide-border border border-border bg-card">
                {product.requests.map((request) => (
                  <li key={request.recordId}>
                    <Link className="body block px-4 py-3 hover:bg-muted" href={`/requests/${request.recordId}`}>
                      {request.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </>
  )
}
