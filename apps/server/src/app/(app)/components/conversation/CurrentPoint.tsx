'use client'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { OptionList } from '../assistant-ui/elements/option-list'
import type { Point } from '../../../../lib/refine/model'

/** The point being asked: its options (one click records it, no model call), the stored reason, and the shortcut for everything else. Free text goes to the composer below. */
export const CurrentPoint: FC<{ point: Point; open: number; busy: boolean; onPick(option: number): Promise<void>; onWhy(): void; onRest(): void }> = ({ point, open, busy, onPick, onWhy, onRest }) => (
  <section data-testid="current-point" data-point={point.id} aria-label="Current question" className="flex flex-col gap-2 rounded-md border bg-card p-3">
    <h3 className="m-0 text-[14px] leading-5 font-semibold wrap-anywhere">{point.title}</h3>
    {point.options.length > 0 && (
      <OptionList
        key={point.id}
        aria-label={point.title}
        className="max-w-none border-0 bg-transparent p-0 dark:bg-transparent"
        options={point.options.map((label, i) => ({ id: String(i), label, ...(label === point.default && { description: 'Recommended' }) }))}
        onConfirm={([i]) => onPick(Number(i))}
      />
    )}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="h-auto whitespace-normal" disabled={busy} onClick={onWhy}>Why does this matter?</Button>
      {open > 1 && <Button type="button" size="sm" variant="outline" className="h-auto whitespace-normal text-left" disabled={busy} onClick={onRest}>Use the recommended answers for the rest</Button>}
      <span className="small text-muted-foreground">or answer in your own words below</span>
    </div>
  </section>
)
