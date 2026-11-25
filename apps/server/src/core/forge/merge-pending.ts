import { GithubError, type Forge, type PullRequest } from '@bauherr/adapters'
import { WriteError } from './errors'

export class MergePending extends WriteError {}

const IN_PROGRESS = /merge already in progress/i

const isTransient = (error: unknown): error is GithubError =>
  error instanceof GithubError &&
  (error.status >= 500 || (error.status === 405 && IN_PROGRESS.test(error.message)))

export const settleMerge = async (
  forge: Pick<Forge, 'getPullRequest'>,
  repo: Parameters<Forge['getPullRequest']>[0],
  number: number,
  error: unknown,
): Promise<{ mergeSha: string }> => {
  if (!isTransient(error)) throw error
  const pull: PullRequest = await forge.getPullRequest(repo, number)
  if (pull.state === 'merged' && pull.mergeSha) return { mergeSha: pull.mergeSha }
  if (pull.state === 'open') throw new MergePending(error.message)
  throw error
}
