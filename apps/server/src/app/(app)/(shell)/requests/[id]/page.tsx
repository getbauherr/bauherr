import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageTitle } from '../../../components/PageTitle'
import { payloadClient } from '../../../lib/session'
import { productsOf, requireProductOwner } from '../../../lib/requests'

export const dynamic = 'force-dynamic'

export default async function Request({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireProductOwner()
  const id = Number((await params).id)
  const products = await productsOf(await payloadClient(), user.assignments)
  const product = products.find((p) => p.requests.some((r) => r.recordId === id))
  const request = product?.requests.find((r) => r.recordId === id)
  if (!product || !request) notFound()
  return (
    <>
      <PageTitle>{request.title}</PageTitle>
      <h1 className="title">{request.title}</h1>
      <p className="small text-muted-foreground">{product.name}</p>
      <Link className="small underline" href="/requests">
        Back to Requests
      </Link>
    </>
  )
}
