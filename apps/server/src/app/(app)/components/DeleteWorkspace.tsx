'use client'
import { useState } from 'react'
import { deleteWorkspace } from '../(shell)/settings/actions'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

type Impact = { products: number; tickets: number; runs: number; sessions: number; keys: number; connections: number }

/** Danger section of Settings > General (Admin): names what the deletion stops and removes, enables the button once the typed name matches. */
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
    const res = await deleteWorkspace({}, fd).catch(() => ({ error: 'Could not delete the Workspace. Please try again.' }))
    if (res.error) setError(res.error)
    setBusy(false)
  }
  const rows: [number, string][] = [[impact.products, 'Products'], [impact.tickets, 'Tickets'], [impact.runs, 'active Runs'], [impact.sessions, 'agent sessions'], [impact.keys, 'agent keys (Workspace keys and embed tokens)'], [impact.connections, 'Connections']]
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTyped(''); setError('') } }}>
      <DialogTrigger asChild><Button type="button" variant="destructive">Delete workspace</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>Its work stops now and it disappears from every list. Restorable until {until}.</DialogDescription>
        </DialogHeader>
        <ul className="small flex flex-col gap-1">
          {rows.map(([n, label]) => <li key={label}>{n} {label}</li>)}
        </ul>
        <p className="small text-muted-foreground">Issues and merge requests on the forge and the Knowledge repo stay untouched. Personal agent keys stay, and so do Connection secrets (LLM provider keys, forge tokens): rotate them where they came from if needed.</p>
        <div className="flex flex-col gap-1">
          <Label htmlFor="delete-workspace-name" className="small">Type <span className="mono">{name}</span> to confirm</Label>
          <Input id="delete-workspace-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep workspace</Button>
          <Button type="button" variant="destructive" disabled={busy || typed !== name} onClick={() => void submit()}>Delete workspace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
