'use client'

import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { useState } from 'react'
import { Composer } from '../conversation/Composer'
import { AssistantMessage, UserMessage } from '../conversation/Thread'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { RequestCard } from './RequestCard'
import { RequestQuestions } from './RequestQuestions'
import { useRequestSession, type Initial } from './useRequestSession'
import type { DraftView } from '../../../../core/requests/view'

type Props = {
  workspace: number
  products: { id: number; name: string }[]
  product: number
  initial: Initial | null
}

function ProductChoice(props: { products: Props['products']; product: number; onChange: (id: number) => void }) {
  const [chosen, setChosen] = useState(props.product)
  return (
    <div className="grid gap-1 sm:max-w-xs">
      <Label htmlFor="request-product">Product</Label>
      <NativeSelect
        id="request-product"
        value={chosen}
        onChange={(event) => {
          setChosen(Number(event.target.value))
          props.onChange(Number(event.target.value))
        }}
      >
        {props.products.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}

function JoinOffer({ draft, busy, join }: { draft: DraftView | null; busy: boolean; join: () => void }) {
  const offer = draft?.offer
  if (!offer) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-3">
      <p className="small m-0 mr-auto">
        #{offer.number} {offer.title} is already open.
      </p>
      <button type="button" className="small underline" disabled={busy} onClick={join}>
        Join it instead
      </button>
    </div>
  )
}

export function NewRequest({ workspace, products, product, initial }: Props) {
  const session = useRequestSession(workspace, product, initial)
  const { draft, busy, error } = session
  const open = draft === null || draft.state === 'open'
  return (
    <div className="grid h-[calc(100dvh-8rem)] min-h-0 gap-6 lg:grid-cols-[1fr_24rem]">
      <AssistantRuntimeProvider runtime={session.runtime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-col gap-4">
          {!session.started && <ProductChoice products={products} product={product} onChange={session.setProduct} />}
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <ThreadPrimitive.Empty>
              <p className="small m-0 text-muted-foreground">
                Describe what you need in your own words. Nothing is written to the issue tracker until you send it.
              </p>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            {open && draft && (
              <RequestQuestions key={draft.rounds} questions={draft.questions} busy={busy} onAnswer={session.answer} />
            )}
            {busy && <p className="small m-0 text-muted-foreground">The factory is reading your message…</p>}
          </ThreadPrimitive.Viewport>
          {error && (
            <p role="alert" className="small m-0 text-destructive">
              {error}
            </p>
          )}
          {open && <JoinOffer draft={draft} busy={busy} join={() => session.act({ action: 'join' })} />}
          {open && <Composer placeholder="Describe your request" />}
        </ThreadPrimitive.Root>
        <RequestCard draft={draft} busy={busy} act={session.act} />
      </AssistantRuntimeProvider>
    </div>
  )
}
