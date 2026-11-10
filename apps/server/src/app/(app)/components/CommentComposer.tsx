'use client'
import { useRef, useState, useTransition, type ClipboardEvent, type DragEvent } from 'react'
import { postCommentAction } from '../lib/actions'
import { X } from './icons'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

type Shot = { id: number; name: string; preview: string }

const TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Comment box of the Ticket page: text plus pasted, dropped or picked images, posted to the forge with the images linked. */
export function CommentComposer({ ticket, maxBytes, maxImages }: { ticket: number; maxBytes: number; maxImages: number }) {
  const [text, setText] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [error, setError] = useState('')
  const [posted, setPosted] = useState<string[] | null>(null)
  const [pending, post] = useTransition()
  const [uploading, setUploading] = useState(0)
  const pick = useRef<HTMLInputElement>(null)

  const add = async (files: File[]) => {
    setError('')
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
      if (!TYPES.includes(file.type)) return setError('Only png, jpeg or webp images.')
      if (file.size > maxBytes) return setError(`Image larger than ${Math.round(maxBytes / 1048576)} MB.`)
      setUploading((n) => n + 1)
      const body = new FormData()
      body.set('file', file)
      const res = await fetch(`/api/tickets/${ticket}/media`, { method: 'POST', body }).catch(() => null)
      setUploading((n) => n - 1)
      const json = (await res?.json().catch(() => null)) as { id?: number; error?: string } | null
      if (!json?.id) return setError(json?.error ?? 'Upload failed.')
      setShots((s) => [...s, { id: json.id!, name: file.name, preview: URL.createObjectURL(file) }])
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) (e.preventDefault(), void add(files))
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    void add(Array.from(e.dataTransfer.files))
  }
  const send = () =>
    post(async () => {
      const r = await postCommentAction(ticket, text, shots.map((s) => s.id))
      if ('error' in r) return setError(r.error)
      setError('')
      setPosted(r.images)
      setText('')
      setShots([])
    })

  return (
    <section className="flex flex-col gap-4" aria-labelledby="comment">
      <h2 className="heading" id="comment">Comment</h2>
      <div className="flex flex-col gap-4" style={{ maxWidth: 640 }}>
        <Textarea aria-label="Comment" placeholder="Write a comment; paste or drop images" value={text} onChange={(e) => (setText(e.target.value), setPosted(null))} onPaste={onPaste} onDrop={onDrop} onDragOver={(e) => e.preventDefault()} />
        {shots.length > 0 && (
          <ul className="shots" aria-label="Images to post">
            {shots.map((s) => (
              <li key={s.id} className="small">
                <img src={s.preview} alt={s.name} />
                {s.name}
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${s.name}`} onClick={() => setShots((all) => all.filter((x) => x.id !== s.id))}><X /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="row" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input ref={pick} type="file" accept={TYPES.join(',')} multiple hidden aria-label="Pick images" onChange={(e) => (void add(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
          <Button type="button" variant="outline" disabled={shots.length >= maxImages || uploading > 0} onClick={() => pick.current?.click()}>Add image</Button>
          <Button type="button" disabled={pending || uploading > 0 || (!text.trim() && !shots.length)} onClick={send}>Post comment</Button>
          {uploading > 0 && <span className="small text-muted-foreground" role="status">Uploading…</span>}
        </div>
        {error && <p className="small crit" role="alert">{error}</p>}
        {posted && (
          <div role="status" className="small">
            Posted to the forge.
            <ul className="shots">{posted.map((u) => <li key={u}><img src={u} alt="Posted" /></li>)}</ul>
          </div>
        )}
      </div>
    </section>
  )
}
