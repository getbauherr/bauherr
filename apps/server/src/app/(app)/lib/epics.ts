import type { Where } from 'payload'
import type { Stage } from './needs-you'
import { board, byKind, type Workflow } from '../../../lib/workflow'

export type EpicChild = { id: number; number: number; title: string; stage: Stage; open: boolean; status: string }
export type EpicSlice = { title: string; child: EpicChild | null; passed: boolean }
export type Epic = { id: number; number: number; title: string; open: boolean; parked?: boolean; rank: string | null; product: number | null; children: EpicChild[]; slices?: EpicSlice[]; current?: number | null }

export const epicHue = (id: number): number => Math.round(id * 137.508) % 360

export const epicShortTitle = (title: string): string => (title.length > 18 ? `${title.slice(0, 17)}…` : title)

export { statusLine as plainStatus } from './status'

export const epicCount = (e: Pick<Epic, 'children' | 'slices'>): { done: number; total: number } =>
  e.slices ? { done: e.slices.filter((s) => s.passed).length, total: e.slices.length } : { done: e.children.filter((c) => !c.open).length, total: e.children.length }

export const epicProgress = (wf: Workflow, e: Pick<Epic, 'children' | 'slices' | 'parked'>): { done: number; total: number; stages: { stage: Stage; count: number }[] } => {
  const live = e.parked ? [] : e.slices ? e.slices.flatMap((s) => (s.child && !s.passed && s.child.open ? [s.child] : [])) : e.children.filter((c) => c.open)
  return { ...epicCount(e), stages: board(wf).map((stage) => ({ stage, count: live.filter((c) => c.stage === stage).length })).filter((s) => s.count) }
}

export const epicSlicing = (e: Pick<Epic, 'slices' | 'current'>): { index: number; total: number; stage: Stage | null } | null =>
  e.slices && e.current != null ? { index: e.current + 1, total: e.slices.length, stage: e.slices[e.current]?.child?.stage ?? null } : null

export const epicsToShow = (epics: Epic[], showDone: boolean, product: number | null): Epic[] =>
  epics
    .filter((e) => (showDone || e.open) && (!product || e.product === product))
    .sort((a, b) => Number((a.rank ?? '') > (b.rank ?? '')) - Number((a.rank ?? '') < (b.rank ?? '')) || a.number - b.number)

export const epicWhere = (wf: Workflow, parentIds: number[]): Where => ({ or: [{ stage: { equals: byKind(wf, 'container')?.name ?? '' } }, ...(parentIds.length ? [{ id: { in: parentIds } }] : [])] })

export const epicRestoreUrl = (path: string, sp: Record<string, string | undefined>, stored: unknown, epics: { id: number; open: boolean }[]): string | null =>
  sp.epic === undefined && epics.some((e) => e.id === stored && e.open)
    ? `${path}?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)) as Record<string, string>), epic: String(stored) })}`
    : null

export const epicNamed = (param: string | undefined, epics: { id: number }[]): number | null | undefined =>
  param === undefined ? undefined : (epics.find((e) => e.id === Number(param))?.id ?? null)

export const inEpic = <T extends { parent: { id: number } | null }>(rows: T[], epic: number | null): T[] => (epic ? rows.filter((t) => t.parent?.id === epic) : rows)
