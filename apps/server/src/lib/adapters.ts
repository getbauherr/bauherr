import { GithubBackend, patAuth, type Backend } from '@bauherr/adapters'
import type { ConnectionInput } from './connection'
import { fakeForge } from './fake-forge'

/** `config.apiUrl` overrides the API base (GitHub Enterprise, test stubs). `BAUHERR_E2E_FAKE_FORGE=1` swaps in an in-memory forge for the Playwright run. */
export const githubFor = (connection: ConnectionInput): Backend => {
  if (process.env.BAUHERR_E2E_FAKE_FORGE === '1') return fakeForge()
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  const baseUrl = connection.config.apiUrl
  return new GithubBackend({ auth: patAuth(connection.secret), ...(typeof baseUrl === 'string' ? { baseUrl } : {}) })
}
