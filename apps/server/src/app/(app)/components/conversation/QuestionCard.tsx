'use client'
import type { FC } from 'react'
import { Pencil } from '../chat/icons'
import { Button } from '../ui/button'
import { OptionList } from '../assistant-ui/elements/option-list'
import type { Point } from '../../../../lib/refine/model'

/**
 * The open point being asked, as a card in the stream: "Question n of m", the question, one line of why with "Why this matters" (answered from the stored reason, no model call),
 * its options (one click records it; the default is marked Recommended), and the two shortcuts. Built from `OptionList`; the registry's `QuestionFlow` is not used because it keeps
 * its own state and confirms every answer at the end, while each answer here is recorded on the server at once and the next question follows from the engine.
 */
export const QuestionCard: FC<{ point: Point; n: number; of: number; open: number; busy: boolean; onPick(option: number): Promise<void>; onWhy(): void; onRest(): void }> = ({ point, n, of, open, busy, onPick, onWhy, onRest }) => (
  <section data-testid="current-point" data-point={point.id} aria-label="Current question" className="mt-1 flex flex-col overflow-hidden rounded-md border border-border bg-card">
    <div className="flex flex-col gap-1 px-4 pt-3.5">
      <p className="m-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Question {n} of {of}</p>
      <h3 className="m-0 text-[16px] leading-6 font-semibold wrap-anywhere">{point.title}</h3>
      {point.why && (
        <p className="m-0 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
          {point.why} <button type="button" disabled={busy} onClick={onWhy} className="cursor-pointer text-primary hover:underline">Why this matters</button>
        </p>
      )}
    </div>
    {point.options.length > 0 && (
      <div className="p-2">
        <OptionList
          key={point.id}
          aria-label={point.title}
          className="max-w-none border-0 bg-transparent p-0 dark:bg-transparent"
          options={point.options.map((label, i) => ({ id: String(i), label, ...(label === point.default && { badge: 'Recommended' }) }))}
          onConfirm={([i]) => onPick(Number(i))}
        />
      </div>
    )}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/50 px-4 py-2 text-[13px] text-muted-foreground">
      <span className="flex items-center gap-2"><Pencil size={14} />Or answer in your own words below</span>
      {open > 1 && <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy} onClick={onRest}>Use recommended for the rest</Button>}
    </div>
  </section>
)
