import type { HeldItem } from '../../../core/intake/held'
import type { BoardCard } from '../../../core/views/board'
import { INBOX_GROUPS, type InboxGroupId } from '../../../core/views/inbox'

export const GROUPS = INBOX_GROUPS
export type GroupId = InboxGroupId

export const INBOX_PAGE = 50

export type InboxRow = { kind: 'ticket'; card: BoardCard } | { kind: 'held'; item: HeldItem; repo: string }

export const GROUP_TITLES: Record<GroupId, string> = {
  you: 'Waiting on you',
  working: 'Agents working',
  others: 'Waiting on others',
  done: 'Done',
}
