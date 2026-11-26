'use client'
import { useActionState, useEffect, useState } from 'react'
import {
  checkReadinessNow,
  makeReadinessTicket,
  saveReadinessFix,
} from '../../(shell)/settings/products/[id]/actions'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'

type Setting = 'required-checks' | 'risk-areas'

const DIALOG: Record<Setting, { title: string; text: string }> = {
  'required-checks': {
    title: 'Require these checks?',
    text: 'Verify waits for them before a ticket reaches you. Nothing is written to the repository.',
  },
  'risk-areas': {
    title: 'Add these risk areas?',
    text:
      'A change that touches these paths always gets a Brief for you to approve. ' +
      'Nothing is written to the repository.',
  },
}

type FixProps = { product: number; check: string }

export function SettingFix({ product, check, setting, label, value }: FixProps & {
  setting: Setting
  label: string
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(saveReadinessFix, {})
  useEffect(() => {
    if (state.saved) setOpen(false)
  }, [state])
  const words = DIALOG[setting]
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="id" value={product} />
          <input type="hidden" name="check" value={check} />
          <DialogHeader>
            <DialogTitle>{words.title}</DialogTitle>
            <DialogDescription>{words.text}</DialogDescription>
          </DialogHeader>
          <pre className="mono small m-0 overflow-x-auto rounded-md border border-border bg-secondary p-3">{value}</pre>
          {state.error && <p role="alert" className="small text-destructive">{state.error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button disabled={pending}>Confirm</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TicketFix({ product, check, label }: FixProps & { label: string }) {
  const [state, action, pending] = useActionState(makeReadinessTicket, {})
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <input type="hidden" name="id" value={product} />
      <input type="hidden" name="check" value={check} />
      <Button variant="outline" disabled={pending}>{label}</Button>
      {state.error && <span role="alert" className="small max-w-64 text-destructive">{state.error}</span>}
    </form>
  )
}

const LINK_BUTTON =
  'small cursor-pointer border-0 bg-transparent p-0 text-primary underline underline-offset-2 disabled:no-underline'

export function CheckNow({ product, button = false }: { product: number; button?: boolean }) {
  const [state, action, pending] = useActionState(checkReadinessNow, {})
  return (
    <form action={action} className="inline-flex flex-wrap items-baseline gap-2">
      <input type="hidden" name="id" value={product} />
      {button ? (
        <Button variant="outline" disabled={pending}>{pending ? 'Checking' : 'Check now'}</Button>
      ) : (
        <button type="submit" disabled={pending} className={LINK_BUTTON}>
          {pending ? 'Checking' : 'Check now'}
        </button>
      )}
      {state.error && <span role="alert" className="small text-destructive">{state.error}</span>}
    </form>
  )
}
