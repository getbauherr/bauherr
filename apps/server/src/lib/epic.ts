import type { Where } from 'payload'

/** Query part that leaves out parked Tickets (a stopped epic and its open slices): they hold no WIP, start no Run and are not watched. */
export const NOT_PARKED: Where = { parked: { not_equals: true } }

/** `tickets.epic` on a parent: the epic integration branch, its PR and the slice plan. Presence switches the Ticket to epic behaviour. */
export type EpicField = {
  branch: string
  pr?: string
  slices: { title: string; body: string; ticket?: number }[]
  current: number
  mergeFailures: number
  /** The approved plan's `## Goal` (whitespace collapsed): a re-plan that keeps it and the built slices is accepted without the plan gate. */
  goal?: string
}

/** `tickets.slice` on a sub-ticket of an epic: `branch` is the epic branch, `prev`/`main`/`head` the SHAs bounding the slice's commits. */
export type SliceField = {
  epic: number
  branch: string
  index: number
  prev: string | null
  main: string | null
  head: string | null
  passed: boolean
  fixes: { sha: string; finding: string }[]
}
