import { BOARD_STAGES, type Stage } from './needs-you'

export type EpicChild = { id: number; number: number; title: string; stage: Stage; open: boolean; status: string }
export type Epic = { id: number; number: number; title: string; open: boolean; rank: string | null; product: number | null; children: EpicChild[] }

/** Stable hue (golden-angle spread) per epic id; CSS turns it into a light/dark-safe colour. */
export const epicHue = (id: number): number => Math.round(id * 137.508) % 360

export const epicShortTitle = (title: string): string => (title.length > 18 ? `${title.slice(0, 17)}…` : title)

/** What the Bauherr should read instead of run internals. */
export const plainStatus = (t: { open: boolean; needsYou: string | null; blockedBy: unknown[]; waiting: string | null; run: { status: string } | null }): string =>
  !t.open ? 'Done' : t.needsYou ? 'Needs you' : t.run && ['running', 'awaiting_session'].includes(t.run.status) ? 'Working' : t.blockedBy.length ? 'Blocked' : t.waiting ? 'Waiting' : 'Queued'

/** `done`: closed sub-tickets of `total`; `stages`: open sub-tickets per Board column, in column order. */
export const epicProgress = (e: Pick<Epic, 'children'>): { done: number; total: number; stages: { stage: Stage; count: number }[] } => ({
  done: e.children.filter((c) => !c.open).length,
  total: e.children.length,
  stages: BOARD_STAGES.map((stage) => ({ stage, count: e.children.filter((c) => c.open && c.stage === stage).length })).filter((s) => s.count),
})

/** Epics in rank order (then number); done ones (closed) only with `showDone`; `product` narrows when set. */
export const epicsToShow = (epics: Epic[], showDone: boolean, product: number | null): Epic[] =>
  epics
    .filter((e) => (showDone || e.open) && (!product || e.product === product))
    .sort((a, b) => Number((a.rank ?? '') > (b.rank ?? '')) - Number((a.rank ?? '') < (b.rank ?? '')) || a.number - b.number)

/** Keeps the sub-tickets of one epic; everything when no epic is chosen. */
export const inEpic = <T extends { parent: { id: number } | null }>(rows: T[], epic: number | null): T[] => (epic ? rows.filter((t) => t.parent?.id === epic) : rows)
