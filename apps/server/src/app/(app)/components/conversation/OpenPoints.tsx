'use client'
import type { FC } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Point } from '../../../../lib/refine/model'

const STATUS = { open: ['Open', 'accent'], answered: ['Answered', 'ok'], dropped: ['No longer needed', 'neutral'] } as const

/** The open points of a Ticket: state, not a message. One row per point with its status, the answer, "Change" and "Why"; the first open one is the current one. */
export const PointsList: FC<{ points: Point[]; busy: boolean; locked: boolean; onChange(id: string): void }> = ({ points, busy, locked, onChange }) => {
  const current = points.find((p) => p.status === 'open')?.id
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {points.map((p) => {
        const [label, tone] = STATUS[p.status]
        return (
          <li key={p.id} data-testid="point" data-point={p.id} data-status={p.status} aria-current={p.id === current ? 'step' : undefined} className={`flex flex-col gap-1.5 rounded-md border p-2.5 ${p.id === current ? 'border-primary bg-accent/40' : 'border-border'}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="small min-w-0 font-medium wrap-anywhere">{p.title}</span>
              <Badge variant={tone} className="shrink-0">{label}</Badge>
            </div>
            {p.answer && <p className="small m-0 text-muted-foreground wrap-anywhere" data-testid="point-answer">{p.status === 'dropped' ? `Not needed${p.answer ? `: ${p.answer}` : ''}` : p.answer}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {p.status !== 'open' && !locked && <Button type="button" variant="ghost" size="sm" className="h-auto px-1.5 py-0.5 text-primary" disabled={busy} onClick={() => onChange(p.id)}>Change</Button>}
              {p.why && (
                <details className="small text-muted-foreground">
                  <summary className="cursor-pointer">Why</summary>
                  <p className="m-0 mt-1 wrap-anywhere">{p.why}</p>
                </details>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export const countOf = (points: Point[]): string => `${points.filter((p) => p.status === 'open').length} of ${points.length} open`

/** Wide: a sticky column next to the conversation. Narrow: a sticky bar on top that expands. */
export const OpenPoints: FC<{ points: Point[]; busy: boolean; locked: boolean; onChange(id: string): void }> = (p) => (
  <>
    <details data-testid="open-points-bar" className="sticky top-[calc(var(--next-step-h,0px)+var(--space-2,0.5rem))] z-10 rounded-md border bg-card p-2 @xl:hidden">
      <summary className="small cursor-pointer font-medium">Open points · {countOf(p.points)}</summary>
      <div className="mt-2 max-h-[50dvh] overflow-y-auto"><PointsList {...p} /></div>
    </details>
    <aside data-testid="open-points" aria-label="Open points" className="hidden flex-col gap-3 @xl:sticky @xl:top-[calc(var(--next-step-h,0px)+var(--space-4,1rem))] @xl:flex @xl:max-h-[calc(100dvh-8rem)] @xl:overflow-y-auto">
      <h3 className="label m-0 text-muted-foreground">Open points · <span data-testid="points-count">{countOf(p.points)}</span></h3>
      <PointsList {...p} />
    </aside>
  </>
)
