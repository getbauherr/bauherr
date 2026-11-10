'use client'
import { AssistantRuntimeProvider, useAui, useAuiState } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { X as Close } from '@/components/icons'
import { api, remember, type Meta } from './api'
import { DockThread, kindOf, type Command } from './dock-thread'
import { ContextChip, usePageContext, WasAbout, type PageContext } from './page-context'
import { useChatRuntime } from './runtime'
import { shikiCss } from './markdown'
import { ThreadList } from './thread-list'

const iconBtn = 'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'

const Body: FC<{ info: PageContext | null; was: { id: string | undefined; context: Meta['context'] } }> = ({ info, was }) => {
  const aui = useAui()
  const threadId = useAuiState((s) => s.threadListItem.remoteId)
  const [note, setNote] = useState<string | null>(null)
  const commands = useMemo<Command[]>(
    () => [
      { name: 'context', help: 'Show what the assistant sees on this page', run: () => setNote(info ? `${info.label}\n\n${info.markdown}` : 'No page context yet.') },
      { name: 'new', help: 'Start a new chat', run: () => void aui.threads().switchToNewThread() },
      { name: 'help', help: 'List the commands', run: () => setNote('/context  show what the assistant sees on this page\n/new  start a new chat\n/help  this list\n\nCommands stay on your screen; the assistant never gets them.') },
    ],
    [aui, info],
  )
  const above = (
    <>
      {note && (
        <div data-testid="local-note" className="flex items-start gap-2 rounded-md border bg-secondary p-2">
          <pre className="max-h-40 min-w-0 flex-1 overflow-auto font-mono text-xs whitespace-pre-wrap">{note}</pre>
          <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={() => setNote(null)}><Close /></button>
        </div>
      )}
      <WasAbout was={was.id && was.id === threadId ? was.context : null} now={info?.path} />
      <ContextChip info={info} />
    </>
  )
  return <DockThread kind={kindOf(info?.path ?? '/')} commands={commands} above={above} />
}

const Runtime: FC<{ initial: string | undefined; userKey: string; onClose(): void }> = ({ initial, userKey, onClose }) => {
  const router = useRouter()
  const info = usePageContext()
  const [was, setWas] = useState<{ id: string | undefined; context: Meta['context'] }>({ id: undefined, context: null })
  const runtime = useChatRuntime({ onLoaded: (id, context) => setWas({ id, context }), onWrite: () => router.refresh() }, initial, userKey)
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <header className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-[15px] font-semibold">Factory chat</h2>
        <div className="flex items-center gap-0.5">
          <ThreadList />
          <button type="button" aria-label="Close chat" title="Close (Ctrl+J)" className={iconBtn} onClick={onClose}><Close /></button>
        </div>
      </header>
      <Body info={info} was={was} />
    </AssistantRuntimeProvider>
  )
}

/** The chat itself, loaded on first open: the last open thread (if it still exists) is reopened. */
export default function ChatPanel({ userKey, onClose }: { userKey: string; onClose(): void }) {
  const [initial, setInitial] = useState<string | null | undefined>(undefined)
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    const stored = remember.get(userKey)
    if (!stored) return setInitial(null)
    api.fetch(stored).then((m) => setInitial(m.archived ? null : stored)).catch(() => setInitial(null))
  }, [userKey])
  return (
    <>
      <style>{shikiCss}</style>
      {initial === undefined ? <p className="p-3 text-[14px] text-muted-foreground">Loading...</p> : <Runtime initial={initial ?? undefined} userKey={userKey} onClose={onClose} />}
    </>
  )
}
