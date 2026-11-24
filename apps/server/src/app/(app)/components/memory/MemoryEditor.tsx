'use client'
import { EditorView } from '@codemirror/view'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { saveDocumentAction, type DocumentChoice } from '../../(shell)/memory/document-actions'
import { linesOver } from '../../lib/memory-checks'
import { TooltipProvider } from '../ui/tooltip'
import { memoryState } from './editor-view'
import { MemoryFooter } from './MemoryFooter'
import { MemoryPreview } from './MemoryPreview'
import { MemoryToolbar } from './MemoryToolbar'

type Props = { choice: DocumentChoice; initial: string; maxLines: number; mayChange: boolean; whoMay: string }
type Tab = 'write' | 'preview'

const TABS: { id: Tab; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'preview', label: 'Preview' },
]

function useEditor(initial: string, readOnly: boolean, onChange: (body: string) => void) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  useEffect(() => {
    const created = new EditorView({
      parent: host.current ?? undefined,
      state: memoryState(initial, onChange, readOnly),
    })
    view.current = created
    return () => {
      created.destroy()
      view.current = null
    }
  }, [initial, readOnly, onChange])
  return { host, view }
}

export function MemoryEditor({ choice, initial, maxLines, mayChange, whoMay }: Props) {
  const router = useRouter()
  const [body, setBody] = useState(initial)
  const [tab, setTab] = useState<Tab>('write')
  const [error, setError] = useState<string | null>(null)
  const [savedBody, setSavedBody] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const { host, view } = useEditor(initial, !mayChange, setBody)
  const over = linesOver(body, maxLines)
  const save = () =>
    start(async () => {
      const result = await saveDocumentAction({ ...choice, body })
      setError(result.error ?? null)
      setSavedBody(result.error ? null : body)
      if (!result.error) router.refresh()
    })
  return (
    <TooltipProvider delayDuration={300}>
      <div className="rounded-md border border-border bg-card">
        <div role="tablist" aria-label="Document view" className="flex border-b border-border px-3">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`memory-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`memory-panel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px border-b-2 border-transparent px-3 py-2.5 text-muted-foreground outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring',
                tab === id && 'border-primary font-medium text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="memory-panel-write" aria-labelledby="memory-tab-write" hidden={tab !== 'write'}>
          <MemoryToolbar view={view} disabled={!mayChange} />
          <div ref={host} />
        </div>
        <div role="tabpanel" id="memory-panel-preview" aria-labelledby="memory-tab-preview" hidden={tab !== 'preview'}>
          <MemoryPreview body={body} />
        </div>
        <MemoryFooter
          body={body}
          maxLines={maxLines}
          hint={mayChange ? 'Markdown. Tab indents a list, Enter continues it.' : whoMay}
          error={error}
          saved={savedBody === body && !error}
          disabled={!mayChange || over > 0 || pending}
          onSave={save}
        />
      </div>
    </TooltipProvider>
  )
}
