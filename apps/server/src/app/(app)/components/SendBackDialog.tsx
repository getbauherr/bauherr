'use client'
import { useState } from 'react'
import { sendBackAction } from '../lib/actions'
import type { SendBackOption } from '../../../lib/send-back-options'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Label } from './ui/label'
import { NativeSelect } from './ui/native-select'
import { Textarea } from './ui/textarea'

export function SendBackDialog({ ticket, options }: { ticket: number; options: SendBackOption[] }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(options[0]!.value)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const chosen = options.find((o) => o.value === value) ?? options[0]!
  const submit = async () => {
    setBusy(true)
    setError('')
    const fd = new FormData()
    fd.set('ticket', String(ticket))
    fd.set('option', chosen.value)
    fd.set('note', note)
    const res = await sendBackAction(fd).catch(() => ({ error: 'That did not go through. Try again.' }))
    setBusy(false)
    if (res.error) return setError(res.error)
    setSent(`You sent this back to ${chosen.label.split(':')[0]}${note.trim() ? `: ${note.trim()}` : '.'}`)
    setOpen(false)
    setNote('')
  }
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError('') }}>
        <DialogTrigger asChild><Button type="button" variant="outline" data-testid="send-back">Send back…</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this Ticket back</DialogTitle>
            <DialogDescription>Choose where it goes next.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="send-back-to" className="small">Send back to</Label>
            {options.length > 1 ? (
              <NativeSelect id="send-back-to" value={value} onChange={(e) => setValue(e.target.value as SendBackOption['value'])}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            ) : <p id="send-back-to" className="body m-0">{chosen.label}</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="send-back-note" className="small">{chosen.noteRequired ? 'What needs to change' : 'Why (optional)'}</Label>
            <Textarea id="send-back-note" value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} />
            <p className="small m-0 text-muted-foreground">The agent reads this before it starts. {chosen.consequence}</p>
          </div>
          {error && <p className="text-destructive" role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy || (chosen.noteRequired && !note.trim())} onClick={() => void submit()}>Send back</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {sent && <p role="status" className="small m-0 text-muted-foreground" data-testid="sent-back">{sent}</p>}
    </>
  )
}
