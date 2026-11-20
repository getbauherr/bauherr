import type { loadAssignable, loadBauherren } from '../../lib/settings'

export type Person = Awaited<ReturnType<typeof loadBauherren>>[number]
export type Assignable = Awaited<ReturnType<typeof loadAssignable>>
export type WorkspaceItem = { id: number; label: string }
