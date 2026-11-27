'use client'

import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useState } from 'react'
import { Thread } from '../assistant-ui/elements/thread.aui'
import { Check, ChevronDown } from '../icons'
import { FactoryMessage } from '../inbox/FactoryMessage'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { RequestCard } from './RequestCard'
import { RequestQuestions } from './RequestQuestions'
import { useRequestSession, type Initial } from './useRequestSession'
import type { DraftView } from '../../../../core/requests/view'

const COLUMN = [
  'flex min-h-[calc(100dvh-12rem)] min-w-0 flex-col',
  '[&_.aui-thread-root]:h-auto [&_.aui-thread-root]:flex-1',
  '[&_[data-slot$=thread-viewport]]:overflow-visible',
  '[&_.aui-thread-viewport-footer]:bottom-0',
  '[&_.aui-thread-viewport-footer]:shadow-[0_-14px_14px_-6px_var(--color-background)]',
].join(' ')

type Props = {
  workspace: number
  products: { id: number; name: string }[]
  product: number
  initial: Initial | null
}

function ProductHeader(props: {
  products: Props['products']
  product: number
  locked: boolean
  onChange: (id: number) => void
}) {
  const current = props.products.find((entry) => entry.id === props.product)
  const fixed = props.locked || props.products.length < 2
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="small text-muted-foreground">New request for</span>
      {fixed ? (
        <Badge variant="accent">{current?.name}</Badge>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label={`Product ${current?.name}`}>
              {current?.name}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuLabel>Change Product</DropdownMenuLabel>
            {props.products.map((entry) => (
              <DropdownMenuItem key={entry.id} onSelect={() => props.onChange(entry.id)}>
                {entry.name}
                {entry.id === props.product && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
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
  const [chosen, setChosen] = useState(product)
  const session = useRequestSession(workspace, product, initial)
  const { draft, busy, error } = session
  const open = draft === null || draft.state === 'open'
  const change = (id: number) => {
    setChosen(id)
    session.setProduct(id)
  }
  return (
    <>
      <ProductHeader products={products} product={chosen} locked={session.started} onChange={change} />
      <div className="grid items-start gap-6 pb-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <AssistantRuntimeProvider runtime={session.runtime}>
          <div className={COLUMN}>
            <Thread
              autoFocus={false}
              components={{
                placeholder: 'Describe your request',
                composer: open,
                AssistantMessage: FactoryMessage,
                welcome: (
                  <p className="small m-0 px-2 text-muted-foreground">
                    Describe what you need in your own words. Nothing is written to the issue tracker until you send it.
                  </p>
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
          <div className="lg:sticky lg:top-4">
            <RequestCard draft={draft} busy={busy} act={session.act} />
          </div>
        </AssistantRuntimeProvider>
      </div>
    </>
  )
}
