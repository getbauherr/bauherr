import type { Forge, RepoRef, TicketSource } from '@bauherr/adapters'
import { backendFor } from '../../lib/adapters'
import type { ConnectionInput } from '../../lib/connection'

export type ReadTickets = Pick<TicketSource, 'list' | 'get' | 'poll' | 'listComments'>
export type ReadForge = Pick<
  Forge,
  | 'listOpenPullRequests'
  | 'getPullRequest'
  | 'listChecks'
  | 'getRepository'
  | 'requiredChecks'
  | 'isBranchProtected'
  | 'fileExists'
  | 'getFile'
  | 'countIssueForms'
>
export type ForgeReader = { tickets: (repo: RepoRef) => ReadTickets; forge: ReadForge }

export const readerFor = (connection: ConnectionInput): ForgeReader => {
  const backend = backendFor(connection)
  return { tickets: (repo) => backend.tickets(repo), forge: backend.forge }
}
