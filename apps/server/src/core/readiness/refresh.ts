import type { Payload } from 'payload'
import { holdOf } from '../forge/limits'
import { refreshFacts } from '../mirror/facts'
import { errorText } from '../mirror/map'
import { liveSources, type SourceRow } from '../mirror/source-store'
import type { SyncDeps } from '../mirror/sync'
import { refreshReleaseState } from '../releases/state'
import { saveLastCheck } from './last-check'
import { refreshReleaseFacts } from './release-facts'

export type RefreshDeps = Pick<SyncDeps, 'reader' | 'now'>
export type Refreshed = { checked: number; errors: string[] }

const checkSource = async (payload: Payload, deps: RefreshDeps, source: SourceRow): Promise<string | null> => {
  try {
    const reader = await deps.reader(source)
    const error = await refreshFacts(payload, source, reader.forge, deps.now())
    if (error !== null) return error
    await refreshReleaseFacts(payload, source, reader.forge)
    await refreshReleaseState(payload, source, reader.forge)
    return null
  } catch (error) {
    return errorText(error)
  }
}

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
    if (only === null && (await holdOf(payload, source.connection, deps.now()))) continue
    const at = deps.now()
    const error = await checkSource(payload, deps, source)
    await saveLastCheck(payload, source.id, { at: at.toISOString(), error })
    if (error === null) result.checked++
    else result.errors.push(`${source.repo}: ${error}`)
  }
  return result
}
