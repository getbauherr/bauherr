'use client'
import type { FC, ReactNode } from 'react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ReviewableDiff } from '../assistant-ui/elements/reviewable-diff'
import { TodoList, type TodoItem } from '../assistant-ui/elements/todo-list'
import { cn } from '@/lib/utils'
import type { View } from '../../../../lib/refine/engine'
import type { Section } from '../../../../lib/refine/artifact'

/** Markdown-lite of a Ticket section: paragraphs and `-` bullets, enough for what the Ticket text holds. */
const Text: FC<{ text: string; changed: boolean }> = ({ text, changed }) => {
  const mark = (t: string): ReactNode => (changed ? <mark className="rounded-xs bg-accent px-0.5 text-foreground underline decoration-primary decoration-2 underline-offset-2">{t}</mark> : t)
  return (
    <div className="flex flex-col gap-1.5 text-[14px] leading-6 wrap-anywhere">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split('\n')
        return lines.every((l) => /^\s*[-*]\s+/.test(l)) ? (
          <ul key={i} className="m-0 flex list-disc flex-col gap-1 pl-5">{lines.map((l, j) => <li key={j}>{mark(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>
        ) : (
          <p key={i} className="m-0 whitespace-pre-wrap">{mark(block)}</p>
        )
      })}
    </div>
  )
}

const Block: FC<{ s: Section }> = ({ s }) => (
  <section data-testid="artifact-section" data-section={s.key} data-changed={s.changed || undefined} data-placeholder={s.point ? (s.point.now ? 'now' : 'open') : undefined} className="flex flex-col gap-2 border-b border-border pb-5 last:border-b-0">
    <h3 className="m-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{s.heading}</h3>
    {s.point ? <p className="m-0 rounded-md border border-dashed border-border px-3 py-2 text-[14px] text-muted-foreground">{s.text}</p> : <Text text={s.text} changed={s.changed} />}
  </section>
)

/**
 * The living artifact: the Ticket as it will be sent (title, type), the open points as its checklist, then its sections with what the conversation changed highlighted and a
 * placeholder per open point. `diff` swaps the sections for the reviewable diff of the changed ones.
 */
export const TicketArtifact: FC<{ view: View; number: number; kind: string | null; locked: boolean; busy: boolean; diff: boolean; onChange(id: string): void }> = ({ view, number, kind, locked, busy, diff, onChange }) => {
  const open = view.points.filter((p) => p.status === 'open')
  const now = open[0]?.id
  const a = view.artifact
  const items: TodoItem[] = view.points.map((p) => ({
    id: p.id,
    text: p.title,
    status: p.status === 'answered' ? 'done' : p.status === 'dropped' ? 'cancelled' : p.id === now && !locked ? 'active' : 'pending',
    description: p.status === 'answered' ? p.answer : p.status === 'dropped' ? 'No longer needed' : p.id === now ? 'Being asked now' : undefined,
    action: p.status !== 'open' && !locked ? <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-primary" disabled={busy} onClick={() => onChange(p.id)}>Change</Button> : undefined,
  }))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 data-testid="artifact-title" data-changed={a.titleChanged || undefined} className={cn('m-0 text-[20px] leading-7 font-semibold wrap-anywhere', a.titleChanged && 'underline decoration-primary decoration-2 underline-offset-4')}>#{number} {a.title}</h2>
        {kind && <Badge variant="neutral">{kind}</Badge>}
      </div>
      <TodoList data-testid="open-points" title="Open points" count={open.length ? `${open.length} of ${view.points.length} open` : 'all settled'} items={items} className="border-b border-border pb-5" />
      {diff ? (
        <div data-testid="artifact-diff" className="flex flex-col gap-3">
          {a.titleChanged && <ReviewableDiff filename="Title" hunks={[{ id: 'title', range: 'Title', lines: [{ kind: 'removed', text: view.ticket.title }, { kind: 'added', text: a.title }] }]} />}
          {a.hunks.length ? <ReviewableDiff filename="Ticket text" hunks={a.hunks} /> : !a.titleChanged && <p className="m-0 text-[14px] text-muted-foreground">The conversation has not changed the Ticket yet.</p>}
        </div>
      ) : (
        a.sections.map((s) => <Block key={s.key} s={s} />)
      )}
    </div>
  )
}
