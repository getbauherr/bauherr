import type { Payload, PayloadRequest } from 'payload'
import { decrypt } from './secrets'

const id = (v: unknown): number | string =>
  v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string)

export interface ConnectionInput {
  id: number | string
  kind: 'github' | 'gitlab' | 'llm-provider'
  config: Record<string, unknown>
  secret: string | null
  capabilities: Record<string, boolean>
}

export const connectionInput = async (
  payload: Payload,
  ref: unknown,
  req?: Partial<PayloadRequest>,
): Promise<ConnectionInput> => {
  const c = await payload.findByID({
    collection: 'connections',
    id: id(ref),
    overrideAccess: true,
    showHiddenFields: true,
    ...(req && { req }),
  })
  const raw = c.secret as string | undefined
  return {
    id: c.id,
    kind: c.kind as ConnectionInput['kind'],
    config: (c.config as ConnectionInput['config'] | null) ?? {},
    secret: raw ? decrypt(raw) : null,
    capabilities: (c.capabilities as ConnectionInput['capabilities'] | null) ?? {},
  }
}

export const webOrigin = (connection: Pick<ConnectionInput, 'kind' | 'config'>): string => {
  if (connection.kind !== 'gitlab') return 'https://github.com'
  const url = new URL(
    typeof connection.config.baseUrl === 'string' && connection.config.baseUrl
      ? connection.config.baseUrl
      : 'https://gitlab.com',
  )
  if (url.protocol !== 'https:') throw new Error('the GitLab base URL must be https')
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export const isGithubApp = (connection: Pick<ConnectionInput, 'kind' | 'config'>): boolean =>
  connection.kind === 'github' && !!connection.config.appId && !!connection.config.installationId

export const credentialName = (connection: Pick<ConnectionInput, 'kind' | 'config'>): string =>
  isGithubApp(connection) ? 'the App credentials' : 'the token'

const fieldErrors = (errors: { path: string; message: string }[]) =>
  Object.assign(new Error('Connection invalid.'), { data: { errors } })

const githubConfig = (before: ConnectionInput | null, field: (name: string) => string): Record<string, unknown> => {
  const apiUrl = before?.config.apiUrl
  const config: Record<string, unknown> = typeof apiUrl === 'string' ? { apiUrl } : {}
  const keeps = !!before && isGithubApp(before)
  if (field('auth') !== 'app') {
    if (keeps && !field('secret')) throw fieldErrors([{ path: 'secret', message: 'Enter a personal access token.' }])
    return config
  }
  const errors: { path: string; message: string }[] = (['appId', 'installationId'] as const)
    .filter((k) => !/^\d+$/.test(field(k)))
    .map((path) => ({ path, message: 'Enter the number shown in GitHub.' }))
  if (!keeps && !field('secret')) errors.push({ path: 'secret', message: 'Paste the App private key.' })
  if (errors.length) throw fieldErrors(errors)
  return { ...config, appId: field('appId'), installationId: field('installationId') }
}

export const forgeConfig = async (
  payload: Payload,
  id: number,
  kind: string,
  field: (name: string) => string,
): Promise<Record<string, unknown>> => {
  if (kind === 'gitlab') return { baseUrl: webOrigin({ kind, config: { baseUrl: field('baseUrl') } }) }
  return githubConfig(id ? await connectionInput(payload, id) : null, field)
}
