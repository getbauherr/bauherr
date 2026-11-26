import Link from 'next/link'
import { notFound } from 'next/navigation'
import { proposalsOf } from '../../../../../../core/retro/converse'
import { ticketTitles } from '../../../../../../core/retro/history'
import { loadRetro, messagesOf } from '../../../../../../core/retro/store'
import { PageTitle } from '../../../../components/PageTitle'
import { TodoList } from '../../../../components/assistant-ui/elements/todo-list'
import { Preparing } from '../../../../components/retro/Preparing'
import { RetroThread } from '../../../../components/retro/RetroThread'
import type { RetroEntry } from '../../../../components/retro/retro-adapter'
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
  const entries: RetroEntry[] = messages.map((message, index) => ({
    id: String(message.id),
    role: message.role,
    body: message.body,
    proposals: message.parts?.proposals ?? [],
    opening: index === 0 ? retro.opening : null,
  }))
  return (
    <>
      <PageTitle>Retro</PageTitle>
      <h1 className="title">Retro: {retro.label}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <RetroThread
          retro={retro.id}
          entries={entries}
          agreed={retro.agreed}
          titles={Object.fromEntries(titles)}
          open={retro.state !== 'applied'}
          empty={<Preparing retro={retro.id} opening={retro.opening} />}
        />
        <aside className="grid gap-4">
          <section aria-label="Agreed so far">
            <TodoList
              title="Agreed so far"
              description={items.length === 0 ? 'Nothing agreed yet. Accept a proposal or talk it through.' : undefined}
              items={items.map((item) => ({
                id: item.id,
                text: item.title,
                description: LEVEL_LABEL[item.level],
                status: 'done' as const,
              }))}
            />
          </section>
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
