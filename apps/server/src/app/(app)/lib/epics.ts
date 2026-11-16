import type { Where } from 'payload'
import type { Stage } from './needs-you'
import { board, byKind, type Workflow } from '../../../lib/workflow'

export type EpicChild = { id: number; number: number; title: string; stage: Stage; open: boolean; status: string }
/** One planned slice of an epic: `child` is its sub-ticket once built (lazy creation), `passed` once its slice review passed. */
export type EpicSlice = { title: string; child: EpicChild | null; passed: boolean }
/** `slices`: the plan in order (absent on an old parent); `current`: index of the slice being built while the parent is in the container stage, else null. */
export type Epic = { id: number; number: number; title: string; open: boolean; parked?: boolean; rank: string | null; product: number | null; children: EpicChild[]; slices?: EpicSlice[]; current?: number | null }

/** Stable hue (golden-angle spread) per epic id; CSS turns it into a light/dark-safe colour. */
export const epicHue = (id: number): number => Math.round(id * 137.508) % 360

export const epicShortTitle = (title: string): string => (title.length > 18 ? `${title.slice(0, 17)}…` : title)

/** The one-line status of a Ticket (`statusLine`); the chat engine still imports it under this name. */
export { statusLine as plainStatus } from './status'

/** Slices passed of the planned ones for an epic; closed sub-tickets of all for an old parent. Every n/m count of an epic comes from here. */
export const epicCount = (e: Pick<Epic, 'children' | 'slices'>): { done: number; total: number } =>
  e.slices ? { done: e.slices.filter((s) => s.passed).length, total: e.slices.length } : { done: e.children.filter((c) => !c.open).length, total: e.children.length }

/** `done`/`total`: `epicCount`; `stages`: open sub-tickets still in flight per Board column, in column order. */
export const epicProgress = (wf: Workflow, e: Pick<Epic, 'children' | 'slices' | 'parked'>): { done: number; total: number; stages: { stage: Stage; count: number }[] } => {
  const live = e.parked ? [] : e.slices ? e.slices.flatMap((s) => (s.child && !s.passed && s.child.open ? [s.child] : [])) : e.children.filter((c) => c.open)
  return { ...epicCount(e), stages: board(wf).map((stage) => ({ stage, count: live.filter((c) => c.stage === stage).length })).filter((s) => s.count) }
}

/** The slice being built ("Slice 2/4" in the stage of its sub-ticket) while the epic parent is split; null otherwise. */
export const epicSlicing = (e: Pick<Epic, 'slices' | 'current'>): { index: number; total: number; stage: Stage | null } | null =>
  e.slices && e.current != null ? { index: e.current + 1, total: e.slices.length, stage: e.slices[e.current]?.child?.stage ?? null } : null

/** Epics in rank order (then number); done ones (closed) only with `showDone`; `product` narrows when set. */
export const epicsToShow = (epics: Epic[], showDone: boolean, product: number | null): Epic[] =>
  epics
    .filter((e) => (showDone || e.open) && (!product || e.product === product))
    .sort((a, b) => Number((a.rank ?? '') > (b.rank ?? '')) - Number((a.rank ?? '') < (b.rank ?? '')) || a.number - b.number)

/** Epics are structural: stage `parent` (just split) or any Ticket with sub-tickets, so a done epic (stage `done`, closed) stays one. */
export const epicWhere = (wf: Workflow, parentIds: number[]): Where => ({ or: [{ stage: { equals: byKind(wf, 'container')?.name ?? '' } }, ...(parentIds.length ? [{ id: { in: parentIds } }] : [])] })

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
