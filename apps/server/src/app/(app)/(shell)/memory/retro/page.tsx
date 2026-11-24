import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { StartForm } from '../../../components/retro/StartForm'
import { held } from '../../../lib/retro-wiring'
import { startData } from '../../../lib/retro-start'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<Record<string, string | undefined>> }

export default async function StartRetroPage({ searchParams }: Props) {
  const params = await searchParams
  const data = await startData(await held(), params)
  if (!data) return <EmptyState text="Connect a repository to a Product before you hold a Retro." />
  return (
    <>
      <PageTitle>Start a Retro</PageTitle>
      <h1 className="title">Start a Retro for {data.product.name}</h1>
      <StartForm data={data} params={params} />
    </>
  )
}
