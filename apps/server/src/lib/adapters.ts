import { GithubBackend, GitlabBackend, gitlabPat, patAuth, type Backend } from '@bauherr/adapters'
import { webOrigin, type ConnectionInput } from './connection'

const fake = process.env.BAUHERR_E2E_FAKE_FORGE === '1'
if (fake && process.env.NODE_ENV === 'production') throw new Error('BAUHERR_E2E_FAKE_FORGE must not be set in production')
const fakeForge = fake ? (await import('./fake-forge')).fakeForge : null

/**
 * Backend of a forge Connection. GitHub: `config.apiUrl` overrides the API base (GitHub Enterprise, test stubs). GitLab: `config.baseUrl`.
 * `BAUHERR_E2E_FAKE_FORGE=1` (never in production) swaps in an in-memory forge for the Playwright run.
 */
export const backendFor = (connection: ConnectionInput, limits: { maxRetries?: number; timeoutMs?: number } = {}): Backend => {
  if (fakeForge) return fakeForge()
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  if (connection.kind === 'gitlab') return new GitlabBackend({ auth: gitlabPat(connection.secret), baseUrl: webOrigin(connection), ...limits })
  const baseUrl = connection.config.apiUrl
  return new GithubBackend({ auth: patAuth(connection.secret), ...(typeof baseUrl === 'string' ? { baseUrl } : {}), ...limits })
}
