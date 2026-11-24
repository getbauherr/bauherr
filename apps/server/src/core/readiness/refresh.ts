import type { Payload } from 'payload'
import { refreshFacts } from '../mirror/facts'
import { errorText } from '../mirror/map'
import { liveSources } from '../mirror/store'
import type { SyncDeps } from '../mirror/sync'

export type RefreshDeps = Pick<SyncDeps, 'reader' | 'now'>
export type Refreshed = { checked: number; errors: string[] }

export const refreshReadiness = async (
  payload: Payload,
  deps: RefreshDeps,
  only: { workspace: number; product: number } | null,
): Promise<Refreshed> => {
  const result: Refreshed = { checked: 0, errors: [] }
  const sources = (await liveSources(payload)).filter(
    (source) => only === null || (source.workspace === only.workspace && source.product === only.product),
  )
  for (const source of sources) {
    try {
      const reader = await deps.reader(source)
      const error = await refreshFacts(payload, source, reader.forge, deps.now())
      if (error === null) result.checked++
      else result.errors.push(`${source.repo}: ${error}`)
    } catch (error) {
      result.errors.push(`${source.repo}: ${errorText(error)}`)
    }
  }
  return result
}
