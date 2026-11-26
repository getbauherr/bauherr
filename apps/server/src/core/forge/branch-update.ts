import type { Forge } from '@bauherr/adapters'
import { TargetNotFound } from './errors'

export type BranchUpdate =
  | { kind: 'current' }
  | { kind: 'updated'; headSha: string }
  | { kind: 'conflict'; base: string }

export const bringUpToDate = async (
  forge: Forge,
  repo: string,
  number: number,
  retarget: boolean,
): Promise<BranchUpdate> => {
  const pull = await forge.getPullRequest(repo, number)
  const base = retarget ? (await forge.getRepository(repo)).defaultBranch : pull.base
  if (pull.base !== base) await forge.retargetPullRequest(repo, number, base)
  const branch = await forge.getBranch(repo, base)
  if (branch === null) throw new TargetNotFound(`${repo} has no branch ${base}.`)
  const merged = await forge.mergeIntoBranch(repo, pull.head, branch.sha)
  if ('conflict' in merged) return { kind: 'conflict', base }
  return merged.sha === pull.headSha ? { kind: 'current' } : { kind: 'updated', headSha: merged.sha }
}
