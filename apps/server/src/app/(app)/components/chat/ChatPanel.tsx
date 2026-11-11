'use client'
import { AssistantRuntimeProvider, useAui, useAuiState } from '@assistant-ui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { X as Close } from '@/components/icons'
import { postDockComment } from '../../lib/actions'
import { api, remember, type Meta } from './api'
import { onRequest, takeRequest, type DockRequest } from './dock-state'
import { DockThread, kindOf, type Command } from './dock-thread'
import { ContextChip, usePageContext, WasAbout, type PageContext } from './page-context'
import { answerWithText, useHasQuestion } from './questions'
import { useChatRuntime } from './runtime'
import { shikiCss } from './markdown'
import { ThreadList } from './thread-list'

const iconBtn = 'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'

type Was = { id: string | undefined; context: Meta['context']; ticket: number | null }

const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#chat-dock textarea')?.focus())

const Body: FC<{ info: PageContext | null; was: Was }> = ({ info, was }) => {
  const aui = useAui()
  const router = useRouter()
  const hasQuestion = useHasQuestion()
  const threadId = useAuiState((s) => s.threadListItem.remoteId)
  const [note, setNote] = useState<{ text: string; images?: string[] } | null>(null)
  const ticket = was.id && was.id === threadId ? was.ticket : null
  useEffect(() => {
    const openTicket = async ({ ticket: id, mode }: Exclude<DockRequest, string>) => {
      try {
        await aui.threads().switchToThread(String((await api.ticketThread(id)).id))
        if (mode === 'comment') aui.composer().setText('/comment ')
        focusComposer()
      } catch {
        setNote({ text: 'The Ticket chat could not be opened.' })
      }
    }
    const handle = () => {
      const r = takeRequest()
      if (r === 'new') void aui.threads().switchToNewThread()
      if (r && typeof r === 'object') void openTicket(r)
      else if (r) focusComposer()
    }
    handle()
    return onRequest(handle)
  }, [aui])
  const commands = useMemo<Command[]>(
    () => [
      { name: 'context', help: 'Show what the assistant sees on this page', run: () => setNote({ text: info ? `${info.label}\n\n${info.markdown}` : 'No page context yet.' }) },
      { name: 'new', help: 'Start a new chat', run: () => void aui.threads().switchToNewThread() },
      ...(ticket
        ? [{
            name: 'comment',
            help: "Post a comment on this Ticket's issue (pasted images included)",
            arg: true,
            run: async (text: string, mediaIds: number[]) => {
              const r = await postDockComment(ticket, text, mediaIds)
              if ('error' in r) return setNote({ text: r.error }), false
              setNote({ text: 'Posted to the issue.', images: r.images })
              router.refresh()
            },
          }]
        : []),
      ...(hasQuestion ? [{ name: 'answer', help: 'Answer the open question with your own text', arg: true, run: (text: string) => (text ? answerWithText(text) : false) }] : []),
      { name: 'help', help: 'List the commands', run: () => setNote({ text: `/context  show what the assistant sees on this page\n/new  start a new chat\n${ticket ? '/comment <text>  post a comment on the Ticket\'s issue\n' : ''}${hasQuestion ? '/answer <text>  answer the open question\n' : ''}/help  this list\n\nCommands stay on your screen; the assistant never gets them.` }) },
    ],
    [aui, info, ticket, hasQuestion, router],
  )
  const above = (
    <>
      {note && (
        <div data-testid="local-note" className="flex items-start gap-2 rounded-md border bg-secondary p-2">
          <div className="min-w-0 flex-1" role="status">
            <pre className="max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap">{note.text}</pre>
            {!!note.images?.length && <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">{note.images.map((u) => <li key={u}><img src={u} alt="Posted" className="size-16 rounded-md border object-cover" /></li>)}</ul>}
          </div>
          <button type="button" aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={() => setNote(null)}><Close /></button>
        </div>
      )}
      <WasAbout was={!ticket && was.id && was.id === threadId ? was.context : null} now={info?.path} />
      <ContextChip info={info} />
    </>
  )
  return <DockThread kind={ticket ? 'ticket' : kindOf(info?.path ?? '/')} commands={commands} above={above} />
}

const Runtime: FC<{ initial: string | undefined; userKey: string; onClose(): void }> = ({ initial, userKey, onClose }) => {
  const router = useRouter()
  const [was, setWas] = useState<Was>({ id: undefined, context: null, ticket: null })
  const info = usePageContext(was.ticket ? `/tickets/${was.ticket}` : undefined)
  const runtime = useChatRuntime({ onLoaded: (id, context, ticket) => setWas({ id, context, ticket }), onWrite: () => router.refresh() }, initial, userKey)
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
