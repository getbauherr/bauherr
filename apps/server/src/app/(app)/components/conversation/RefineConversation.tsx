'use client'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import { Info } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react'
import { Check } from '@/components/icons'
import { refineChange, refineExplain, refineFinish, refinePick, refineRest, refineState, refineTier } from '../../lib/actions'
import { AgentHandoff } from '../assistant-ui/elements/agent-handoff'
import { makeAttachments } from '../chat/adapter'
import { Button } from '../ui/button'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import type { View } from '../../../../lib/refine/engine'
import { openOf, withoutQuestion, type Tier } from '../../../../lib/refine/model'
import { Composer } from './Composer'
import { ConversationShell } from './ConversationShell'
import { ParticipantHeader } from './ParticipantHeader'
import { QuestionCard } from './QuestionCard'
import { Stream, when } from './Stream'
import { TicketArtifact } from './TicketArtifact'
import { Restore, mediaId, pending, textOf, toMessage } from './shared'
import { useTurn } from './useTurn'

type Reply = { view: View | null } | { error: string }
const attachments = makeAttachments()

/**
 * The refinement conversation of a Ticket in the conversation shell: the participant header, the stream with the open question as a card, the composer with its model and cost
 * chips, and the refined Ticket as the living artifact with the one "Send to planning" at its foot. Every action answers the whole state; the page never merges.
 * `info` is the server-rendered Ticket meta (the artifact header's info popover), `where` says where the Ticket is after sending.
 */
export const RefineConversation: FC<{ ticket: number; kind: string | null; where: string; info?: ReactNode; /** In the Ticket page's split: no side panel, no "more" menu. */ embedded?: boolean }> = ({ ticket, kind, where, info, embedded = false }) => {
  const router = useRouter()
  const [view, setView] = useState<View | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restore, setRestore] = useState('')
  const [recorded, setRecorded] = useState<string | null>(null)
  const [diff, setDiff] = useState(false)
  useEffect(() => {
    if (!recorded) return
    const t = setTimeout(() => setRecorded(null), 2500)
    return () => clearTimeout(t)
  }, [recorded])
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
    void refineState(ticket).then((r) => alive.current && take(r)).catch(() => alive.current && setError('The conversation could not be loaded.'))
  }, [ticket, take])

  const act = useCallback(
    async (run: () => Promise<Reply>, refresh = true): Promise<boolean> => {
      setBusy(true)
      try {
        const ok = take(await run())
        if (ok && refresh) router.refresh()
        return ok
      } catch {
        setError('That did not go through. Try again.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [take, router],
  )
  const onView = useCallback(
    (v: View | null) => {
      setError(null)
      setView(v)
      router.refresh()
    },
    [router],
  )
  const { turn, run, stop } = useTurn<View>(`/api/refine/${ticket}/turn`, onView)
  const model = view ? (view.models.find((m) => m.tier === view.tier)?.model ?? '') : null
  const messages = useMemo(() => {
    const asked = view && !view.sent ? openOf(view.points)[0] : undefined
    const last = view?.messages.findLastIndex((m) => m.role === 'assistant') ?? -1
    const stored = (view?.messages ?? []).map((m, i) => (asked && i === last ? toMessage(m, withoutQuestion(m.text, asked)) : toMessage(m)))
    if (!turn?.user) return stored // a re-check shows no message while it runs
    const at = new Date().toISOString()
    const speaker = view ? { kind: 'assistant' as const, role: view.participant.role, avatar: view.participant.avatar, model, at } : { kind: 'assistant' as const, model, at }
    return [...stored, pending('pending-user', 'user', turn.user, { kind: 'person', at }), pending('pending-assistant', 'assistant', turn.reply, speaker)]
  }, [view, turn, model])

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    isRunning: busy || !!turn,
    convertMessage: (m) => m,
    adapters: { attachments },
    onNew: async (m) => {
      const text = textOf(m)
      if (!text) return
      const images = (m.attachments ?? []).flatMap((a) => a.content ?? []).flatMap((p) => (p.type === 'image' ? [mediaId(p.image)] : [])).filter((i): i is number => i !== null)
      const r = await run({ text, ...(images.length && { images }) }, text)
      if (r.ok) return
      setRestore(text)
      if (!r.aborted) setError(r.error)
    },
  })

  if (view === null) return <p data-testid="no-conversation" className="m-0 rounded-md border border-border bg-card p-4 text-[13px] text-muted-foreground">Nothing was asked on this Ticket. Comments you post to the issue are read at the agent's next Run.</p>
  if (!view || model === null) return error ? <p role="alert" className="m-0 text-destructive">{error}</p> : <p role="status" className="m-0 animate-pulse text-muted-foreground">Loading the conversation...</p>
  const open = openOf(view.points)
  const current = open[0]
  const locked = view.sent
  const a = view.artifact
  const send = async () => {
    if (await act(() => refineFinish(ticket), false)) router.replace(`/tickets/${ticket}?view=conversation`)
  }
  const status = locked ? (view.queued ?? 'Sent to planning.') : open.length ? `Answer ${open.length} more, or take the recommended answers.` : 'All points are settled. Check the Ticket, then send it on.'
  const count = open.length ? `${open.length} of ${view.points.length} open` : 'All settled'
  const version = a.version.at ? `v${a.version.n} · edited ${when(a.version.at)}` : `v${a.version.n}`

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Restore text={restore} done={() => setRestore('')} />
      <div data-testid="refine-panel" data-state={locked ? 'sent' : open.length ? 'open' : 'summary'} className="contents">
        <ConversationShell
          embedded={embedded}
          header={
            <ParticipantHeader
              participant={view.participant}
              model={model}
              subtitle={`refining #${view.ticket.number} with you`}
              menu={embedded ? undefined : <DropdownMenuItem asChild><Link href={`/tickets/${ticket}?view=ticket`}>Ticket page: path, steps, proof</Link></DropdownMenuItem>}
            />
          }
          stream={
            <Stream
              thread={view.thread}
              locked={locked}
              points={view.points}
              busy={busy}
              earlier={view.earlier}
              working={busy && !turn}
              onChange={(id) => void act(() => refineChange(ticket, id))}
              tail={!locked && current && <QuestionCard id={current.id} eyebrow={`Question ${view.points.indexOf(current) + 1} of ${view.points.length}`} title={current.title} why={current.why} options={current.options.map((label) => ({ label, recommended: label === current.default }))} busy={busy} onPick={async (i) => { if (!(await act(() => refinePick(ticket, current.id, i)))) throw new Error('not recorded'); setRecorded(`${current.title}: ${current.options[i]}`); if (open.length > 1) void run({ recheck: { point: current.id } }, null) }} onWhy={() => void act(() => refineExplain(ticket, current.id))} extra={open.length > 1 && <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void act(() => refineRest(ticket))}>Use recommended for the rest</Button>} />}
            >
              {error && <p role="alert" data-testid="refine-error" className="m-0 text-[13px] text-destructive">{error}</p>}
              {recorded && <p role="status" data-testid="recorded" className="m-0 flex items-center gap-1.5 text-[13px] text-ok"><Check />Recorded. {recorded}</p>}
              {turn && !turn.user && <p role="status" data-testid="rechecking" className="m-0 animate-pulse text-[13px] text-muted-foreground">Checking the remaining points...</p>}
              {locked && <AgentHandoff data-testid="handoff" from={view.participant.role} to={view.planner} reason={view.next.replace(/^Then: /, 'Next: ')} carried={view.points.filter((p) => p.status === 'answered').map((p) => `${p.title}: ${p.answer}`)} settled />}
            </Stream>
          }
          composer={locked ? <p data-testid="read-only" className="m-0 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[13px] text-muted-foreground">{view.queued ?? 'Sent to planning.'} This conversation is read-only history.</p> : <Composer models={view.models} tier={view.tier} cost={view.viewer === 'bauherr' ? view.cost : null} placeholder={open.length ? 'Answer in your own words' : 'Reply, or ask for a change to the Ticket'} streaming={!!turn?.user} onStop={stop} onModel={(t: Tier) => void act(() => refineTier(ticket, t), false)} />}
          bar={<><span data-testid="bar-count">{count}</span><span className="font-medium text-primary">View outcome</span></>}
          artifact={{
            title: 'Refined ticket',
            version,
            summary: `${count} · ${a.changes} change${a.changes === 1 ? '' : 's'}`,
            writing: !!turn?.user,
            actions: (
              <>
                <Button type="button" variant="ghost" size="sm" data-testid="changes" aria-pressed={diff} className={`h-8 gap-1.5 ${diff ? 'bg-secondary' : ''}`} onClick={() => setDiff((d) => !d)}>Changes <span data-testid="changes-count">{a.changes}</span></Button>
                {info && (
                <Popover>
                  <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="Ticket details" data-testid="ticket-info" className="size-8"><Info className="size-4" /></Button></PopoverTrigger>
                  <PopoverContent align="end" data-testid="ticket-info-content" className="flex max-h-[70dvh] w-96 flex-col gap-4 overflow-y-auto">{info}</PopoverContent>
                </Popover>
                )}
              </>
            ),
            body: <TicketArtifact view={view} number={view.ticket.number} kind={kind} locked={locked} busy={busy} diff={diff} onChange={(id) => void act(() => refineChange(ticket, id))} />,
            foot: (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p data-testid="foot-status" className="m-0 min-w-0 flex-1 basis-40 text-[13px] leading-5 text-muted-foreground">{status}</p>
                  {!locked && open.length > 0 && <Button type="button" variant="outline" disabled={busy || !open.some((p) => p.default)} onClick={() => void act(() => refineRest(ticket))}>Use recommended</Button>}
                  {!locked && <Button type="button" data-testid="send-to-planning" disabled={busy || open.length > 0} onClick={() => void send()}>Send to planning</Button>}
                </div>
                <p data-testid="foot-next" className="m-0 text-[13px] leading-5 text-muted-foreground">{locked ? `Now: ${where}.` : view.next}</p>
              </div>
            ),
          }}
        />
      </div>
    </AssistantRuntimeProvider>
  )
}
