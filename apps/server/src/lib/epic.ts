/** `tickets.epic` on a parent: the epic integration branch, its PR and the slice plan. Presence switches the Ticket to epic behaviour. */
export type EpicField = {
  branch: string
  pr?: string
  slices: { title: string; body: string; ticket?: number }[]
  current: number
  mergeFailures: number
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
