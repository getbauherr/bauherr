'use client'

import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useState } from 'react'
import { Thread } from '../assistant-ui/elements/thread.aui'
import { Button } from '../ui/button'
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
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={join}>
        Join it instead
      </Button>
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
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
          <Thread
            autoFocus={false}
            components={{
              placeholder: 'Describe your request',
              composer: open,
              welcome: (
                <div className="grid gap-4 px-2">
                  {!session.started && (
                    <ProductChoice products={products} product={product} onChange={session.setProduct} />
                  )}
                  <p className="small m-0 text-muted-foreground">
                    Describe what you need in your own words. Nothing is written to the issue tracker until you send it.
                  </p>
                </div>
              ),
              afterMessages: (
                <div className="grid gap-2 pb-4">
                  {open && draft && (
                    <RequestQuestions
                      key={draft.rounds}
                      questions={draft.questions}
                      busy={busy}
                      onAnswer={session.answer}
                    />
                  )}
                  {busy && <p className="small m-0 text-muted-foreground">The factory is reading your message…</p>}
                </div>
              ),
              aboveComposer: (
                <>
                  {error && (
                    <p role="alert" className="small m-0 text-destructive">
                      {error}
                    </p>
                  )}
                  {open && <JoinOffer draft={draft} busy={busy} join={() => session.act({ action: 'join' })} />}
                </>
              ),
            }}
          />
        </div>
        <RequestCard draft={draft} busy={busy} act={session.act} />
      </AssistantRuntimeProvider>
    </div>
  )
}
