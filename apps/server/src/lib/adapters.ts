import { GithubBackend, patAuth, type Backend } from '@bauherr/adapters'
import type { ConnectionInput } from './connection'

const fake = process.env.BAUHERR_E2E_FAKE_FORGE === '1'
if (fake && process.env.NODE_ENV === 'production') throw new Error('BAUHERR_E2E_FAKE_FORGE must not be set in production')
const fakeForge = fake ? (await import('./fake-forge')).fakeForge : null

/** `config.apiUrl` overrides the API base (GitHub Enterprise, test stubs). `BAUHERR_E2E_FAKE_FORGE=1` (never in production) swaps in an in-memory forge for the Playwright run. */
export const githubFor = (connection: ConnectionInput): Backend => {
  if (fakeForge) return fakeForge()
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  const baseUrl = connection.config.apiUrl
  return new GithubBackend({ auth: patAuth(connection.secret), ...(typeof baseUrl === 'string' ? { baseUrl } : {}) })
}
