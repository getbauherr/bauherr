'use client'
import { startTransition, useActionState, useMemo, useState } from 'react'
import { PLACEHOLDERS, SAMPLES, fillPlaceholders, type TemplateName, lintTemplate, parseSections, renderTemplate } from '../../../lib/template-text'
import type { FormState } from '../lib/settings'
import { renderMarkdown } from '../lib/markdown'
import { Markdown } from './Markdown'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Textarea } from './ui/textarea'

type Action = (prev: FormState, fd: FormData) => Promise<FormState>

/** Markdown of a template next to its rendered preview with sample content; the linter runs on every keystroke and Save is refused while it finds an error. */
export function TemplateEditor({ name, initial, packBody, layout, custom, canEdit, save, reset }: { name: TemplateName; initial: string; packBody: string; layout: 'tight' | 'normal'; custom: boolean; canEdit: boolean; save: Action; reset: Action }) {
  const [body, setBody] = useState(initial)
  const [checked, setChecked] = useState(false)
  const [asking, setAsking] = useState(false)
  const [saved, saveAction, saving] = useActionState(save, {})
  const [resetState, resetAction, resetting] = useActionState(reset, {})
  const findings = useMemo(() => lintTemplate(name, body), [name, body])
  const errors = findings.filter((f) => f.level === 'error')
  const preview = useMemo(() => {
    const md = renderTemplate({ parsed: parseSections(body), layout, fallback: {} }, SAMPLES[name])
    return renderMarkdown(name === 'progress' ? fillPlaceholders(md, PLACEHOLDERS) : md)
  }, [name, body, layout])
  const post = (action: (fd: FormData) => void) => () => {
    const fd = new FormData()
    fd.set('name', name)
    fd.set('body', body)
    startTransition(() => action(fd))
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className="small text-muted-foreground">Template (markdown; <code>{'{#id}'}</code> marks what the factory fills, comments are guidance)</span>
          <Textarea aria-label="Template" className="mono min-h-[420px] font-mono text-[13px]" value={body} readOnly={!canEdit} spellCheck={false} onChange={(e) => { setBody(e.target.value); setChecked(false) }} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="small text-muted-foreground">Preview with sample content</span>
          <div data-testid="template-preview" className="min-h-[420px] rounded-md border border-border bg-card p-4"><Markdown html={preview} /></div>
        </div>
      </div>
      <ul className="small m-0 flex list-none flex-col gap-1 p-0" aria-label="Findings">
        {findings.map((f) => <li key={f.message} role={f.level === 'error' ? 'alert' : undefined} className={f.level === 'error' ? 'text-destructive' : 'text-warn'}>{f.message}</li>)}
        {checked && !findings.length && <li role="status" className="text-ok">No problems found.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => setChecked(true)}>Check</Button>
        {canEdit && <Button type="button" disabled={saving || errors.length > 0 || body.trim() === initial.trim()} onClick={post(saveAction)}>Save</Button>}
        {canEdit && custom && <Button type="button" variant="outline" className="text-destructive" disabled={resetting} onClick={() => setAsking(true)}>Reset to default</Button>}
        {saved.saved && <span role="status" className="small text-ok">Saved</span>}
        {saved.error && <span role="alert" className="small text-destructive">{saved.error}</span>}
        {resetState.error && <span role="alert" className="small text-destructive">{resetState.error}</span>}
      </div>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to default</DialogTitle>
            <DialogDescription>The Workspace&apos;s version of this template is deleted and the pack&apos;s default applies again.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setAsking(false); setBody(packBody); post(resetAction)() }}>Reset to default</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
