import type { Where } from 'payload'

export const NOT_PARKED: Where = { parked: { not_equals: true } }

export type EpicField = {
  branch: string
  pr?: string
  slices: { title: string; body: string; ticket?: number }[]
  current: number
  mergeFailures: number
  goal?: string
}

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
