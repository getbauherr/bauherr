'use client'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Bug, Lightbulb, Wrench } from 'lucide-react'
import { requestChange, requestState, requestSubmit } from '../../lib/actions'
import type { CardPatch, RequestView } from '../../../../lib/request-conversation'
import type { Kind } from '../../../../lib/intake/kinds'
import { AgentHandoff } from '../assistant-ui/elements/agent-handoff'
import { makeAttachments } from '../chat/adapter'
import { DiscardDraft } from '../DiscardDraft'
import { Button } from '../ui/button'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { Composer } from './Composer'
import { ConversationShell } from './ConversationShell'
import { ParticipantHeader } from './ParticipantHeader'
import { QuestionCard } from './QuestionCard'
import { RequestArtifact } from './RequestArtifact'
import { Restore, mediaId, pending, textOf, toMessage } from './shared'
import { Stream, when } from './Stream'
import { useTurn } from './useTurn'

type Reply = { view: RequestView | null } | { error: string }
const attachments = makeAttachments('/api/requests/media')

const STARTERS: { kind: Kind; label: string; icon: FC<{ className?: string }>; placeholder: string }[] = [
  { kind: 'bug', label: 'Report a bug', icon: Bug, placeholder: 'What is wrong? Say what happens and where' },
  { kind: 'feature', label: 'Ask for a feature', icon: Lightbulb, placeholder: 'What would you like, for whom, and why?' },
  { kind: 'change', label: 'Change something', icon: Wrench, placeholder: 'What should work differently, and why?' },
]

/** The first screen: nothing was said yet, so the stream asks what the team should fix or build, with the three common starts; a start sets the type of the card. */
const Empty: FC<{ busy: boolean; onStart(kind: Kind): void }> = ({ busy, onStart }) => (
  <div data-testid="empty-state" className="my-auto flex flex-col items-center gap-4 py-8 text-center">
    <h2 className="m-0 text-[22px] leading-8 font-semibold">What should the team fix or build?</h2>
    <p className="m-0 max-w-[44ch] text-[14px] leading-6 text-muted-foreground">Describe it in your own words. I ask a few questions and keep the request card on the right up to date; you file it when it reads right.</p>
    <div className="flex flex-wrap justify-center gap-2">
      {STARTERS.map(({ kind, label, icon: Icon }) => (
        <Button key={kind} type="button" variant="outline" size="sm" disabled={busy} className="h-9 gap-2" data-testid={`start-${kind}`} onClick={() => onStart(kind)}><Icon className="size-4" />{label}</Button>
      ))}
    </div>
  </div>
)

/**
 * Request drafting in the conversation shell: the Factory assistant as the partner, the stream with its question as a card of suggested answers, the composer with attachments, and the
 * living request card as the artifact with "File request" at its foot. A filed request stays here as read-only history with a handoff block. The same for a Product owner (`owner`):
 * the model is a read-only label and there is no cost chip. Every action answers the whole state; the page never merges.
 */
export const RequestConversation: FC<{ session: number; owner: boolean }> = ({ session, owner }) => {
  const router = useRouter()
  const [view, setView] = useState<RequestView | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restore, setRestore] = useState('')
  const [started, setStarted] = useState<Kind | null>(null)
  const [discard, setDiscard] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true // Strict Mode mounts twice in dev
    return () => void (alive.current = false)
  }, [])

  const take = useCallback((r: Reply): boolean => {
    if ('error' in r) return setError(r.error), false
    setError(null)
    setView(r.view)
    return true
  }, [])
  useEffect(() => {
    void requestState(session).then((r) => alive.current && take(r)).catch(() => alive.current && setError('The conversation could not be loaded.'))
  }, [session, take])

  const act = useCallback(
    async (run: () => Promise<Reply>): Promise<boolean> => {
      setBusy(true)
      try {
        return take(await run())
      } catch {
        setError('That did not go through. Try again.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [take],
  )
  const onView = useCallback((v: RequestView | null) => {
    setError(null)
    setView(v)
  }, [])
  const { turn, run, stop } = useTurn<RequestView>(`/api/requests/${session}/turn`, onView)
  const model = view ? view.models.find((m) => m.tier === view.tier)!.model : null
  const messages = useMemo(() => {
    const stored = (view?.messages ?? []).map((m) => toMessage(m))
    if (!turn?.user) return stored
    const at = new Date().toISOString()
    const speaker = view ? { kind: 'assistant' as const, role: view.participant.role, avatar: view.participant.avatar, model, at } : { kind: 'assistant' as const, model, at }
    return [...stored, pending('pending-user', 'user', turn.user, { kind: 'person', at }), pending('pending-assistant', 'assistant', turn.reply, speaker)] satisfies ThreadMessageLike[]
  }, [view, turn, model])

  const send = useCallback(
    async (text: string, images: number[] = []): Promise<boolean> => {
      const r = await run({ text, ...(images.length && { images }) }, text)
      if (r.ok) return true
      setRestore(text)
      if (!r.aborted) setError(r.error)
      return false
    },
    [run],
  )
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: busy || !!turn,
    convertMessage: (m) => m,
    adapters: { attachments },
    onNew: async (m) => {
      const text = textOf(m)
      if (!text) return
      await send(text, (m.attachments ?? []).flatMap((a) => a.content ?? []).flatMap((p) => (p.type === 'image' ? [mediaId(p.image)] : [])).filter((i): i is number => i !== null))
    },
  })

  if (!view || !model) return error ? <p role="alert" className="m-0 text-destructive">{view === null ? 'This request was not found.' : error}</p> : <p role="status" className="m-0 animate-pulse text-muted-foreground">Loading the conversation...</p>
  const card = view.card
  const locked = view.sent
  const empty = !view.messages.length && !turn
  const change = (patch: CardPatch) => act(() => requestChange(session, { patch }))
  const file = async () => {
    if (await act(() => requestSubmit(session))) router.replace(`/requests/${session}?view=conversation`)
  }
  const pick = async (i: number) => {
    if (!(await send(view.options[i]!.label))) throw new Error('not sent')
  }
  const count = card.sent ? 'Filed' : card.missing.length && !card.canSend ? `${card.missing.length} still needed` : 'Ready to file'
  const placeholder = empty ? (STARTERS.find((s) => s.kind === started)?.placeholder ?? 'Describe it in your own words') : view.options.length ? 'Answer in your own words' : 'Reply, or ask for a change to the card'
  const handoff = view.handoff

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Restore text={restore} done={() => setRestore('')} />
      <div data-testid="request-panel" data-state={locked ? 'filed' : card.canSend ? 'ready' : 'open'} className="contents">
        <ConversationShell
          header={
            <ParticipantHeader
              participant={view.participant}
              model={model}
              subtitle=""
              line="Drafts the request with you"
              menu={
                locked ? (
                  <DropdownMenuItem asChild><Link href={`/requests/${session}`}>Request page: progress and Tickets</Link></DropdownMenuItem>
                ) : (
                  <DropdownMenuItem data-testid="discard-draft" onSelect={() => setDiscard(true)}>Discard draft</DropdownMenuItem>
                )
              }
            />
          }
          stream={
            <Stream
              thread={null}
              executor={false}
              name="request-thread"
              locked={locked}
              points={[]}
              busy={busy}
              earlier={[]}
              working={busy && !turn}
              onChange={() => {}}
              tail={!locked && view.options.length > 0 && <QuestionCard eyebrow="Suggested answers" options={view.options} busy={busy} onPick={pick} />}
            >
              {empty && !locked && <Empty busy={busy} onStart={(kind) => { setStarted(kind); void change({ type: kind }) }} />}
              {error && <p role="alert" data-testid="request-error" className="m-0 text-[13px] text-destructive">{error}</p>}
              {handoff && (
                <div data-testid="handoff" className="flex flex-col gap-2">
                  <AgentHandoff from={view.participant.role} to="The team" reason={`Filed as ${handoff.numbers.map((n) => `#${n}`).join(', ')}. The team looks at it and may ask you more. You can follow it under Requests.`} carried={[`${card.title || 'Request'}`, `${card.product?.name ?? ''}`.trim()].filter(Boolean)} settled />
                  <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                    {handoff.ticket && <Link data-testid="handoff-ticket" className="text-primary hover:underline" href={`/tickets/${handoff.ticket.id}`}>Open #{handoff.ticket.number}</Link>}
                    <Link data-testid="handoff-request" className="text-primary hover:underline" href={`/requests/${session}`}>Open the request page</Link>
                  </p>
                </div>
              )}
            </Stream>
          }
          composer={locked ? <p data-testid="read-only" className="m-0 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[13px] text-muted-foreground">Filed. This conversation is read-only history.</p> : <Composer models={view.models} tier={view.tier} cost={owner ? null : view.cost} placeholder={placeholder} streaming={!!turn?.user} onStop={stop} />}
          bar={<><span data-testid="bar-count">{count}</span><span className="font-medium text-primary">View request card</span></>}
          artifact={{
            title: 'Request card',
            version: locked ? 'Filed' : view.messages.length ? `Draft · saved ${when(view.messages.at(-1)!.speaker.at)}` : 'Draft',
            summary: `${card.title || 'New request'} · ${count}`,
            writing: !!turn?.user,
            body: <RequestArtifact card={card} busy={busy || !!turn} started={view.messages.length > 0} onChange={change} onRemoveImage={(id) => void act(() => requestChange(session, { removeImage: id }))} />,
            foot: (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p data-testid="foot-status" className="m-0 min-w-0 flex-1 basis-40 text-[13px] leading-5 text-muted-foreground">{view.status}</p>
                  {!locked && card.kind === 'question' && <Button type="button" variant="outline" disabled={busy || !!turn} onClick={() => void change({ type: 'feature' })}>Turn into a request</Button>}
                  {!locked && card.kind !== 'question' && <Button type="button" data-testid="file-request" disabled={busy || !!turn || !card.canSend} onClick={() => void file()}>{card.parts > 1 ? `File ${card.parts} requests` : 'File request'}</Button>}
                </div>
                <p data-testid="foot-next" className="m-0 text-[13px] leading-5 text-muted-foreground">{view.next}</p>
              </div>
            ),
          }}
        />
        {!locked && <DiscardDraft session={session} title={card.title || 'New request'} open={discard} onOpenChange={setDiscard} />}
      </div>
    </AssistantRuntimeProvider>
  )
}
