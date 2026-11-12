'use client'
import type { FC, ReactNode } from 'react'
import { Pencil } from '../chat/icons'
import { OptionList } from '../assistant-ui/elements/option-list'

export type Choice = { label: string; recommended?: boolean }

/**
 * What the agent asks next, as a card at the end of its message: an eyebrow ("Question 2 of 4"), the question as `title` (left out when the message above already says it), one line of
 * why with "Why this matters" (`onWhy`), the options (one click answers; the recommended one is marked), and "Or answer in your own words below" with `extra` (a shortcut button).
 * Built from `OptionList`; the registry's `QuestionFlow` is not used because it keeps its own state and confirms every answer at the end, while each answer here is recorded at once
 * and the next question follows from the engine.
 */
export const QuestionCard: FC<{ id?: string; eyebrow: string; title?: string; why?: string; options: Choice[]; busy: boolean; onPick(option: number): Promise<void>; onWhy?(): void; extra?: ReactNode }> = ({ id, eyebrow, title, why, options, busy, onPick, onWhy, extra }) => (
  <section data-testid="current-point" data-point={id} aria-label="Current question" className="mt-1 flex flex-col overflow-hidden rounded-md border border-border bg-card">
    <div className="flex flex-col gap-1 px-4 pt-3.5">
      <p className="m-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{eyebrow}</p>
      {title && <h3 className="m-0 text-[16px] leading-6 font-semibold wrap-anywhere">{title}</h3>}
      {why && (
        <p className="m-0 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
          {why} {onWhy && <button type="button" disabled={busy} onClick={onWhy} className="cursor-pointer text-primary hover:underline">Why this matters</button>}
        </p>
      )}
    </div>
    {options.length > 0 && (
      <div className="p-2">
        <OptionList
          key={options.map((o) => o.label).join('|')}
          aria-label={title ?? eyebrow}
          className="max-w-none border-0 bg-transparent p-0 dark:bg-transparent"
          options={options.map((o, i) => ({ id: String(i), label: o.label, ...(o.recommended && { badge: 'Recommended' }) }))}
          onConfirm={([i]) => onPick(Number(i))}
        />
      </div>
    )}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/50 px-4 py-2 text-[13px] text-muted-foreground">
      <span className="flex items-center gap-2"><Pencil size={14} />Or answer in your own words below</span>
      {extra}
    </div>
  </section>
)
