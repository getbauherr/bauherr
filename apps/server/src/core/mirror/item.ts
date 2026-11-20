import type { Payload } from 'payload'
import type { ForgeReader } from '../forge/reader'
import { storePull, syncDeployChecks } from './pulls'
import { storeIssue } from './sync'
import type { SourceRow } from './store'

export const refreshItem = async (
  payload: Payload,
  source: SourceRow,
  reader: ForgeReader,
  item: { kind: 'issue' | 'pr'; number: number },
  now: Date,
): Promise<number[]> => {
  const touched = new Set<number>()
  const context = {
    workspace: source.workspace,
    product: source.product,
    source: source.id,
    repo: source.repo,
    now,
    touched,
  }
  if (item.kind === 'pr') {
    await storePull(payload, context, reader.forge, await reader.forge.getPullRequest(source.repo, item.number))
    await syncDeployChecks(payload, context, reader.forge, item.number)
  } else {
    await storeIssue(payload, context, reader.tickets(source.repo), String(item.number))
  }
  return [...touched]
}
