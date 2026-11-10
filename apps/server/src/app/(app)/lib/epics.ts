import type { Where } from 'payload'
import { statusOf } from './card-status'
import type { Stage } from './needs-you'
import { board, DEFAULT } from '../../../lib/workflow'

export type EpicChild = { id: number; number: number; title: string; stage: Stage; open: boolean; status: string }
export type Epic = { id: number; number: number; title: string; open: boolean; rank: string | null; product: number | null; children: EpicChild[] }

/** Stable hue (golden-angle spread) per epic id; CSS turns it into a light/dark-safe colour. */
export const epicHue = (id: number): number => Math.round(id * 137.508) % 360

export const epicShortTitle = (title: string): string => (title.length > 18 ? `${title.slice(0, 17)}…` : title)

/** What the Bauherr should read instead of run internals; a stopped Run adds its one-line reason. */
export const plainStatus = (t: { open: boolean; needsYou: string | null; blockedBy: unknown[]; waiting: string | null; run: { status: string; error?: string | null } | null }): string =>
  !t.open ? 'Done' : t.needsYou ? `Needs you${['Cancelled', 'Run failed', 'Run needs you'].includes(t.needsYou) && t.run?.error ? `: ${t.run.error.split('\n')[0]!.slice(0, 60)}` : ''}` : statusOf(t) ?? 'Queued'

/** `done`: closed sub-tickets of `total`; `stages`: open sub-tickets per Board column, in column order. */
export const epicProgress = (e: Pick<Epic, 'children'>): { done: number; total: number; stages: { stage: Stage; count: number }[] } => ({
  done: e.children.filter((c) => !c.open).length,
  total: e.children.length,
  stages: board(DEFAULT()).map((stage) => ({ stage, count: e.children.filter((c) => c.open && c.stage === stage).length })).filter((s) => s.count),
})

/** Epics in rank order (then number); done ones (closed) only with `showDone`; `product` narrows when set. */
export const epicsToShow = (epics: Epic[], showDone: boolean, product: number | null): Epic[] =>
  epics
    .filter((e) => (showDone || e.open) && (!product || e.product === product))
    .sort((a, b) => Number((a.rank ?? '') > (b.rank ?? '')) - Number((a.rank ?? '') < (b.rank ?? '')) || a.number - b.number)

/** Epics are structural: stage `parent` (just split) or any Ticket with sub-tickets, so a done epic (stage `done`, closed) stays one. */
export const epicWhere = (parentIds: number[]): Where => ({ or: [{ stage: { equals: 'parent' } }, ...(parentIds.length ? [{ id: { in: parentIds } }] : [])] })

/** Where to send a Board/Runs request that names no epic when one is remembered and still open; null otherwise (stale and finished epics restore to All). */
export const epicRestoreUrl = (path: string, sp: Record<string, string | undefined>, stored: unknown, epics: { id: number; open: boolean }[]): string | null =>
  sp.epic === undefined && epics.some((e) => e.id === stored && e.open)
    ? `${path}?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), epic: String(stored) })}`
    : null

/** What a request names about the epic filter: undefined = nothing (leave the remembered one), null = All or an unknown epic, else the epic id. */
export const epicNamed = (param: string | undefined, epics: { id: number }[]): number | null | undefined =>
  param === undefined ? undefined : (epics.find((e) => e.id === Number(param))?.id ?? null)

/** Keeps the sub-tickets of one epic; everything when no epic is chosen. */
export const inEpic = <T extends { parent: { id: number } | null }>(rows: T[], epic: number | null): T[] => (epic ? rows.filter((t) => t.parent?.id === epic) : rows)
