import Link from 'next/link'
import { notFound } from 'next/navigation'
import { buildOutcome } from '../../../../../../../core/retro/outcome'
import { loadRetro } from '../../../../../../../core/retro/store'
import { memoryProducts } from '../../../../../../../core/views/statement-records'
import { factoryRepo } from '../../../../../../../lib/retro-settings'
import { PageTitle } from '../../../../../components/PageTitle'
import { RetroOutcome } from '../../../../../components/retro/RetroOutcome'
import { held } from '../../../../../lib/retro-wiring'
import { applyRetroAction, decideChangeAction, decideTicketAction, editChangeAction } from '../../actions'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function RetroOutcomePage({ params }: Props) {
  const { payload, who } = await held()
  const id = Number((await params).id)
  const retro = Number.isInteger(id) ? await loadRetro(payload, who.workspace, id) : null
  if (!retro) return notFound()
  const outcome = retro.outcome ?? (await buildOutcome(payload, who, retro.id))
  const product = (await memoryProducts(payload, who.workspace)).find((candidate) => candidate.id === retro.product)
  return (
    <>
      <PageTitle>Retro outcome</PageTitle>
      <h1 className="title">Outcome of the Retro: {retro.label}</h1>
      <RetroOutcome
        initial={outcome}
        applied={retro.state === 'applied'}
        isAdmin={who.person.role === 'admin'}
        repos={{ product: product?.repo ?? '', factory: factoryRepo() }}
        day={new Date().toISOString().slice(0, 10)}
        actions={{
          decideChange: decideChangeAction.bind(null, retro.id),
          editChange: editChangeAction.bind(null, retro.id),
          decideTicket: decideTicketAction.bind(null, retro.id),
          apply: applyRetroAction.bind(null, retro.id),
        }}
      />
      <Link href={`/memory/retro/${retro.id}`} className="small mt-4 block text-primary hover:underline">
        Back to the conversation
      </Link>
    </>
  )
}
