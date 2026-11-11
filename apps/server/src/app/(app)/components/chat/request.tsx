'use client'
import { useAui, useAuiState } from '@assistant-ui/react'
import { useState, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { chooseRequestProduct } from '../../lib/actions'
import type { RequestInfo } from './api'
import { Shield } from './icons'

const CHOSEN = 'chat-request-chosen'
export type Chosen = { session: number; product: string }
export const onChosen = (cb: (c: Chosen) => void) => {
  const h = (e: Event) => cb((e as CustomEvent<Chosen>).detail)
  addEventListener(CHOSEN, h)
  return () => removeEventListener(CHOSEN, h)
}

/** The Product select at the start of a request thread (shown when the Workspace has several): choosing starts the interview; it locks with the first message. */
export const ProductCard: FC<{ thread: number; products: RequestInfo['products']; current: number | null }> = ({ thread, products, current }) => {
  const [value, setValue] = useState(current === null ? '' : String(current))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const started = useAuiState((s) => s.thread.messages.some((m) => m.role === 'user'))
  const pick = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const r = await chooseRequestProduct(thread, Number(id))
      if (!r) return setError('This product could not be chosen.')
      setValue(id)
      dispatchEvent(new CustomEvent<Chosen>(CHOSEN, { detail: r }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This product could not be chosen.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Choose a product" data-testid="product-card" data-state={started ? 'locked' : value ? 'chosen' : 'open'} className="my-2 flex flex-col gap-2 rounded-md border bg-card p-3 text-card-foreground">
      <h3 className="m-0 flex items-center gap-2 text-[14px] leading-5 font-semibold"><Shield />Which product is this for?</h3>
      <Select value={value} onValueChange={(v) => void pick(v)} disabled={busy || started}>
        <SelectTrigger aria-label="Product"><SelectValue placeholder="Choose a product" /></SelectTrigger>
        <SelectContent>{products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
      </Select>
      {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
    </section>
  )
}

/** The interview's answers to pick from: a click sends the label as the next message. Only the last message's buttons are live. */
export const Options: FC<{ options: { label: string; recommended: boolean }[] }> = ({ options }) => {
  const aui = useAui()
  const busy = useAuiState((s) => s.thread.isRunning)
  const live = useAuiState((s) => s.message.isLast)
  return (
    <div data-testid="request-options" className="my-1 flex flex-wrap gap-2">
      {options.map((o) => (
        <Button key={o.label} type="button" size="sm" variant={o.recommended ? 'default' : 'outline'} className="h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal" disabled={busy || !live} onClick={() => aui.thread().append(o.label)}>
          {o.label}{o.recommended && <span className="font-normal opacity-80"> (recommended)</span>}
        </Button>
      ))}
    </div>
  )
}
