'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import { deleteMemoryAction, saveMemoryAction, switchMemoryAction } from '../../(shell)/memory/actions'
import type { Reach } from '../../../../core/memory'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { inputOf, MemoryFields, useDraft, type Draft } from './MemoryFields'

type Props = {
  id: number
  product: number
  initial: Draft
  off: boolean
  hasTicket: boolean
  areas: string[]
  footnote: string
  children: ReactNode
}

function DeleteMemory({ id, text, onDeleted }: { id: number; text: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const press = () =>
    start(async () => {
      const result = await deleteMemoryAction({ id })
      if (result.error) return setError(result.error)
      onDeleted()
    })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this memory?</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        <p className="small text-muted-foreground">Runs stop receiving it. This cannot be undone.</p>
        {error && <p role="alert" className="small text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep memory
          </Button>
          <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={press}>
            Delete memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EditMemory({ id, product, initial, off, hasTicket, areas, footnote, children }: Props) {
  const router = useRouter()
  const { draft, set } = useDraft(initial)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()
  const reaches: Reach[] = hasTicket ? ['always', 'area', 'fit', 'ticket'] : ['always', 'area', 'fit']
  const run = (work: () => Promise<{ error?: string }>, done: () => void) =>
    start(async () => {
      const result = await work()
      setError(result.error ?? null)
      setSaved(false)
      if (!result.error) done()
    })
  const save = () =>
    run(() => saveMemoryAction({ id, input: inputOf(draft) }), () => setSaved(true))
  const flip = () => run(() => switchMemoryAction({ id, off: !off }), () => router.refresh())
  const leave = () => router.push(`/memory?product=${product}`)
  return (
    <form onSubmit={(event) => event.preventDefault()} className="rounded-md border border-border bg-card">
      <div className="grid gap-5 p-6">
        <MemoryFields draft={draft} set={set} reaches={reaches} areas={areas} label="What the factory remembers" />
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <p className="small m-0 mr-auto text-muted-foreground">{footnote}</p>
        {error && <span role="alert" className="small text-destructive">{error}</span>}
        {saved && <span role="status" className="small text-muted-foreground">Saved</span>}
        <DeleteMemory id={id} text={initial.text} onDeleted={leave} />
        <Button type="button" variant="outline" disabled={pending} onClick={flip}>
          {off ? 'Switch on' : 'Switch off'}
        </Button>
        <Button type="button" disabled={pending} onClick={save}>
          Save
        </Button>
      </div>
    </form>
  )
}
