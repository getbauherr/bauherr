import { GithubBackend, patAuth } from '@bauherr/adapters'
import type { ConnectionInput } from './connection'

/** `config.apiUrl` overrides the API base (GitHub Enterprise, test stubs). */
export const githubFor = (connection: ConnectionInput): GithubBackend => {
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  const baseUrl = connection.config.apiUrl
  return new GithubBackend({ auth: patAuth(connection.secret), ...(typeof baseUrl === 'string' ? { baseUrl } : {}) })
}
