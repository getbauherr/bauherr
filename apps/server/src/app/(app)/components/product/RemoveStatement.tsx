'use client'
import { useState } from 'react'
import { removeStatement } from '../../(shell)/settings/products/[id]/actions'
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

type Props = { product: number; id: number; text: string }

export function RemoveStatement({ product, id, text }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
    const fd = new FormData()
    fd.set('product', String(product))
    fd.set('id', String(id))
    const res = await removeStatement({}, fd).catch(() => ({ error: 'Could not remove the Statement. Try again.' }))
    setBusy(false)
    if (res.error) setError(res.error)
    else setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this Statement?</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        <p className="small text-muted-foreground">Runs stop receiving it. This cannot be undone.</p>
        {error && (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep Statement
          </Button>
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={busy}
            onClick={() => void submit()}
          >
            Remove Statement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
