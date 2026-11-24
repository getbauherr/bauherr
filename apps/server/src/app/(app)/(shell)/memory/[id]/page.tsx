import Link from 'next/link'
import { notFound } from 'next/navigation'
import { memoryProducts, statementFare, statementRecord } from '../../../../../core/views/statement-records'
import { MemoryState } from '../../../components/memory/MemoryState'
import { EditMemory } from '../../../components/memory/EditMemory'
import { Fared, Origin } from '../../../components/memory/MemoryDetail'
import { PageTitle } from '../../../components/PageTitle'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const TITLE_MAX = 80

export default async function MemoryOnePage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await currentWorkspace()
  const id = Number((await params).id)
  if (!workspace || !Number.isInteger(id) || id <= 0) notFound()
  const payload = await payloadClient()
  const record = await statementRecord(payload, { workspace: workspace.id, id })
  if (!record) notFound()
  const product = (await memoryProducts(payload, workspace.id)).find((entry) => entry.id === record.product)
  if (!product) notFound()
  const fares = await statementFare(payload, { workspace: workspace.id, id })
  const title = record.text.length > TITLE_MAX ? `${record.text.slice(0, TITLE_MAX)}…` : record.text
  const stages = record.stages
  return (
    <>
      <PageTitle>Edit memory</PageTitle>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/memory/statements?product=${product.id}`} className="text-primary hover:underline">
          Memory
        </Link>
        <h1 className="title">{title}</h1>
        <MemoryState off={record.off} />
      </div>
      <div className="grid max-w-5xl items-start gap-6">
        <EditMemory
          id={record.id}
          product={product.id}
          initial={{ text: record.text, reach: record.reach, area: record.area ?? '', stages }}
          off={record.off}
          hasTicket={record.ticket !== null}
          areas={product.riskAreas}
          footnote={`Handed ${record.handed} times.`}
        >
          <Origin record={record} product={product.name} />
          <Fared fares={fares} />
        </EditMemory>
      </div>
    </>
  )
}
