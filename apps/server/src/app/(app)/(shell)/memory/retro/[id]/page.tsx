import Link from 'next/link'
import { notFound } from 'next/navigation'
import { proposalsOf } from '../../../../../../core/retro/converse'
import { ticketTitles } from '../../../../../../core/retro/history'
import { loadRetro, messagesOf } from '../../../../../../core/retro/store'
import { PageTitle } from '../../../../components/PageTitle'
import { TodoList } from '../../../../components/assistant-ui/elements/todo-list'
import { PreparingOpening } from '../../../../components/retro/PreparingOpening'
import { ProposalCards } from '../../../../components/retro/ProposalCards'
import { RetroComposer } from '../../../../components/retro/RetroComposer'
import { RetroOpening } from '../../../../components/retro/RetroOpening'
import { Button } from '../../../../components/ui/button'
import { LEVEL_LABEL } from '../../../../lib/retro'
import { held } from '../../../../lib/retro-wiring'
import { toOutcomeAction } from '../actions'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function RetroPage({ params }: Props) {
  const { payload, who } = await held()
  const id = Number((await params).id)
  const retro = Number.isInteger(id) ? await loadRetro(payload, who.workspace, id) : null
  if (!retro?.opening) return notFound()
  const messages = await messagesOf(payload, retro.id)
  const known = proposalsOf(messages)
  const evidence = [...known.values()].flatMap((proposal) => proposal.evidence)
  const titles = await ticketTitles(payload, evidence)
  const items = retro.agreed.flatMap((agreedId) => known.get(agreedId) ?? [])
  return (
    <>
      <PageTitle>Retro</PageTitle>
      <h1 className="title">Retro: {retro.label}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5" aria-label="Conversation" role="log">
          {messages.map((message, index) => (
            <div key={message.id} className="grid gap-3">
              <p className="small m-0 font-semibold">{message.role === 'owner' ? 'You' : 'Factory'}</p>
              {index === 0 && <RetroOpening opening={retro.opening as NonNullable<typeof retro.opening>} />}
              <p className="m-0">{message.body}</p>
              <ProposalCards
                retro={retro.id}
                proposals={message.parts?.proposals ?? []}
                agreed={retro.agreed}
                titles={titles}
              />
            </div>
          ))}
          {messages.length === 0 && (
            <>
              <RetroOpening opening={retro.opening} />
              <PreparingOpening retro={retro.id} />
            </>
          )}
          {messages.length > 0 && retro.state !== 'applied' && <RetroComposer retro={retro.id} />}
        </div>
        <aside className="grid gap-4">
          <TodoList
            title="Agreed so far"
            items={items.map((item) => ({
              id: item.id,
              text: item.title,
              badge: LEVEL_LABEL[item.level],
              done: true,
            }))}
          />
          <form action={toOutcomeAction.bind(null, retro.id)}>
            <Button type="submit">{retro.state === 'applied' ? 'See the outcome' : 'To the outcome'}</Button>
          </form>
          <Link href="/memory" className="small text-primary hover:underline">
            Back to Memory
          </Link>
        </aside>
      </div>
    </>
  )
}
