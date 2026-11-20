import type { StoredEvent } from './record/store'

export const MINUTE_MS = 60_000

export type DeployCheck = { name: string; status: string; conclusion: string | null; updatedAt: string }
export type DeployWait = { names: string[]; since: string; limitMinutes: number; now: Date; checks: DeployCheck[] }

export const namesOf = (list: string | null | undefined): string[] => [
  ...new Set((list ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '')),
]

export const deploySince = (events: StoredEvent[]): string | null =>
  events.findLast(
    (event) =>
      event.type === 'ship.merged' ||
      event.type === 'result.accepted' ||
      (event.type === 'question.answered' && event.data.option === 'check-again'),
  )?.createdAt ?? null

export const commitChecksUrl = (forge: string, pullUrl: string, sha: string): string =>
  forge === 'gitlab'
    ? pullUrl.replace(/\/merge_requests\/\d+.*$/, `/commit/${sha}/pipelines`)
    : pullUrl.replace(/\/pull\/\d+.*$/, `/commit/${sha}/checks`)

export const deployOverdue = (since: string, now: Date, limitMinutes: number): boolean =>
  now.getTime() - Date.parse(since) >= limitMinutes * MINUTE_MS
