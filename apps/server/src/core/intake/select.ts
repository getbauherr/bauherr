export const INTAKE_LABEL = 'bauherr:intake'

export type IntakeItem = {
  kind: 'issue' | 'pr'
  state: 'open' | 'closed' | 'merged'
  gone: boolean
  author: string
  authorTrusted: boolean
  authorIsBot: boolean
  labels: string[]
  assignees: string[]
}

export type IntakeSettings = { excludedLabels: string[]; outsideIssuesPerDay: number }
export type IntakeFacts = { admittedTodayByAuthor: Record<string, number> }
export type Selection = { action: 'enter' | 'hold' | 'skip'; reason: string }

type Skip = { reason: string; applies: (item: IntakeItem, settings: IntakeSettings) => boolean }

const SKIPS: Skip[] = [
  { reason: 'not-an-issue', applies: (item) => item.kind !== 'issue' },
  { reason: 'closed', applies: (item) => item.state !== 'open' },
  { reason: 'gone', applies: (item) => item.gone },
  { reason: 'bot', applies: (item) => item.authorIsBot },
  { reason: 'assigned', applies: (item) => item.assignees.length > 0 },
  { reason: 'excluded-label', applies: (item, s) => item.labels.some((label) => s.excludedLabels.includes(label)) },
]

const choose = (action: Selection['action'], reason: string): Selection => ({ action, reason })

export const select = (item: IntakeItem, settings: IntakeSettings, facts: IntakeFacts): Selection => {
  const skip = SKIPS.find((rule) => rule.applies(item, settings))
  if (skip) return choose('skip', skip.reason)
  if (item.authorTrusted) return choose('enter', 'trusted-author')
  if (!item.labels.includes(INTAKE_LABEL)) return choose('hold', 'outside-author')
  const admitted = facts.admittedTodayByAuthor[item.author] ?? 0
  return admitted >= settings.outsideIssuesPerDay ? choose('hold', 'budget') : choose('enter', 'intake-label')
}
