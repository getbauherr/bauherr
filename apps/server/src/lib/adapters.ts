import { GithubBackend, patAuth } from '@bauherr/adapters'
import type { ConnectionInput } from './connection'

export const githubFor = (connection: ConnectionInput): GithubBackend => {
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  return new GithubBackend({ auth: patAuth(connection.secret) })
}
