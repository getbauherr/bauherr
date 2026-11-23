import Link from 'next/link'
import { notFound } from 'next/navigation'
import { memoryProducts, statementRecords } from '../../../../core/views/statement-records'
import { EmptyState } from '../../components/EmptyState'
import { MemoryFilters } from '../../components/memory/MemoryFilters'
import { MemoryTable } from '../../components/memory/MemoryTable'
import { PageTitle } from '../../components/PageTitle'
import { Button } from '../../components/ui/button'
import { countsOf, keep, parseShow } from '../../lib/memory'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ product?: string; show?: string }> }

const EMPTY = 'Nothing remembered yet. Your answers and notes appear here, and you can add your own.'

export default async function MemoryPage({ searchParams }: Props) {
  const { workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const params = await searchParams
  const payload = await payloadClient()
  const products = await memoryProducts(payload, workspace.id)
  const first = products[0]
  if (!first) return <EmptyState text="Add a Product first: memory belongs to a Product." />
  const asked = params.product === undefined ? first : products.find((entry) => entry.id === Number(params.product))
  if (!asked) notFound()
  const show = parseShow(params.show)
  const records = await statementRecords(payload, { workspace: workspace.id, product: asked.id })
  return (
    <>
      <PageTitle>Memory</PageTitle>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Memory</h1>
        <Button asChild className="ml-auto">
          <Link href={`/memory/new?product=${asked.id}`}>Add a memory</Link>
        </Button>
      </div>
      <MemoryFilters show={show} product={asked.id} counts={countsOf(records)} products={products} />
      {records.length === 0 ? (
        <EmptyState text={EMPTY} />
      ) : (
        <>
          <MemoryTable records={keep(records, show)} />
          <p className="small max-w-prose text-muted-foreground">
            Handed: runs that got this memory. Came back: tickets that were corrected for the same thing although the
            run had it.
          </p>
        </>
      )}
    </>
  )
}
