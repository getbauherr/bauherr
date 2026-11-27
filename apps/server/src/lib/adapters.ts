import { createHash } from 'node:crypto'
import {
  GithubBackend,
  GitlabBackend,
  appAuth,
  gitlabPat,
  patAuth,
  type Backend,
  type GithubAuth,
} from '@bauherr/adapters'
import { assertFakeAllowed } from './fake-guard'
import { isGithubApp, webOrigin, type ConnectionInput } from './connection'

const fake = process.env.BAUHERR_E2E_FAKE_FORGE === '1'
assertFakeAllowed('BAUHERR_E2E_FAKE_FORGE')
const fakeForge = fake ? (await import('./fake-forge')).fakeForge : null

const appAuths = new Map<string, GithubAuth>()

const githubAuth = (connection: ConnectionInput, secret: string, limits: Limits): GithubAuth => {
  const { appId, installationId } = connection.config
  if (typeof appId !== 'string' || typeof installationId !== 'string' || !appId || !installationId) {
    return patAuth(secret)
  }
  const key = `${connection.id}:${appId}:${installationId}:${createHash('sha256').update(secret).digest('hex')}`
  const apiUrl = typeof connection.config.apiUrl === 'string' ? connection.config.apiUrl : undefined
  let auth = appAuths.get(key)
  if (!auth) {
    auth = appAuth({
      appId,
      installationId,
      privateKeyPem: secret,
      ...(apiUrl && { baseUrl: apiUrl }),
      ...(limits.fetch && { fetch: limits.fetch }),
      ...(limits.timeoutMs && { timeoutMs: limits.timeoutMs }),
    })
    appAuths.set(key, auth)
  }
  return auth
}

type Limits = { maxRetries?: number; timeoutMs?: number; fetch?: typeof fetch }

export const backendFor = (connection: ConnectionInput, limits: Limits = {}): Backend => {
  if (fakeForge) return fakeForge()
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  if (connection.kind === 'gitlab')
    return new GitlabBackend({
      auth: gitlabPat(connection.secret),
      baseUrl: webOrigin(connection),
      budgetKey: String(connection.id),
      ...limits,
    })
  const baseUrl = connection.config.apiUrl
  return new GithubBackend({
    auth: githubAuth(connection, connection.secret, limits),
    budgetKey: String(connection.id),
    ...(typeof baseUrl === 'string' ? { baseUrl } : {}),
    ...limits,
  })
}

export const gitToken = async (connection: ConnectionInput, limits: Limits = {}): Promise<string> => {
  if (!connection.secret) throw new Error(`connection ${connection.id} has no secret`)
  return isGithubApp(connection) ? githubAuth(connection, connection.secret, limits).token() : connection.secret
}

export const verifyForge = async (connection: ConnectionInput, limits: Limits = {}): Promise<void> => {
  const backend = backendFor(connection, limits)
  if (!isGithubApp(connection)) {
    await backend.tickets('').whoami()
    return
  }
  if (!(await backend.forge.listRepositories()).length) {
    throw new Error('the installation can not read any repository; add repositories to the App installation')
  }
}
