'use client'
import { useState } from 'react'
import { deleteWorkspace } from '../(shell)/settings/actions'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

type Impact = { products: number; sessions: number; connections: number }

function DeleteDetails({ name, until, rows }: { name: string; until: string; rows: [number, string][] }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete {name}?</DialogTitle>
        <DialogDescription>It disappears from every list. Restorable until {until}.</DialogDescription>
      </DialogHeader>
      <ul className="small flex flex-col gap-1">
        {rows.map(([n, label]) => (
          <li key={label}>
            {n} {label}
          </li>
        ))}
      </ul>
      <p className="small text-muted-foreground">
        Issues and merge requests on the forge and the Knowledge repo stay untouched. Personal agent keys stay, and so
        do Connection secrets (LLM provider keys, forge tokens): rotate them where they came from if needed.
      </p>
    </>
  )
}

function ConfirmName({ name, typed, setTyped }: { name: string; typed: string; setTyped: (typed: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="delete-workspace-name" className="small">
        Type <span className="mono">{name}</span> to confirm
      </Label>
      <Input id="delete-workspace-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
    </div>
  )
}

function DeleteFooter({
  canDelete,
  close,
  submit,
}: {
  canDelete: boolean
  close: () => void
  submit: () => Promise<void>
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={close}>
        Keep workspace
      </Button>
      <Button
        type="button"
        variant="outline"
        className="text-destructive"
        disabled={!canDelete}
        onClick={() => void submit()}
      >
        Delete workspace
      </Button>
    </DialogFooter>
  )
}

export function DeleteWorkspace({ name, impact, until }: { name: string; impact: Impact; until: string }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
    const fd = new FormData()
    fd.set('confirm', typed)
    const res = await deleteWorkspace({}, fd).catch(() => ({
      error: 'Could not delete the Workspace. Please try again.',
    }))
    setBusy(false)
    if (res.error) setError(res.error)
    else setOpen(false)
  }
  const rows: [number, string][] = [
    [impact.products, 'Products'],
    [impact.sessions, 'agent sessions'],
    [impact.connections, 'Connections'],
  ]
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setTyped('')
          setError('')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive">
          Delete workspace
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DeleteDetails name={name} until={until} rows={rows} />
        <ConfirmName name={name} typed={typed} setTyped={setTyped} />
        {error && (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        )}
        <DeleteFooter canDelete={!busy && typed === name} close={() => setOpen(false)} submit={submit} />
      </DialogContent>
    </Dialog>
  )
}
