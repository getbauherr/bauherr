import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { mayOpenRequest, requestScope } from '../../../../../core/views/request-access'
import { payloadClient, requirePerson } from '../../../lib/session'

type Props = { children: ReactNode; params: Promise<{ id: string }> }

export default async function RequestLayout({ children, params }: Props) {
  const person = await requirePerson()
  const recordId = Number((await params).id)
  if (!Number.isInteger(recordId) || recordId <= 0) notFound()
  const scope = await requestScope(await payloadClient(), recordId)
  if (scope === null || !mayOpenRequest(person, scope)) notFound()
  return children
}
