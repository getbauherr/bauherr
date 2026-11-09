import type { Payload, PayloadRequest } from 'payload'
import { decrypt } from './secrets'

const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))

/** Decrypted Connection; the secret lives only in memory. */
export interface ConnectionInput {
  id: number | string
  kind: 'github' | 'gitlab' | 'llm-provider'
  config: Record<string, unknown>
  secret: string | null
  capabilities: Record<string, boolean>
}

/** Loads a Connection with its secret decrypted; the plaintext lives only in memory. */
export const connectionInput = async (payload: Payload, ref: unknown, req?: Partial<PayloadRequest>): Promise<ConnectionInput> => {
  const c = await payload.findByID({ collection: 'connections', id: id(ref), overrideAccess: true, showHiddenFields: true, req })
  const raw = (c as { secret?: string }).secret
  return {
    id: c.id,
    kind: c.kind,
    config: c.config ?? {},
    secret: raw ? decrypt(raw) : null,
    capabilities: c.capabilities ?? {},
  }
}

/** Web root of a forge Connection: where MR URLs and clones live. GitLab: `config.baseUrl` (default gitlab.com, https only; a relative URL root like `/gitlab` is kept). */
export const webOrigin = (connection: Pick<ConnectionInput, 'kind' | 'config'>): string => {
  if (connection.kind !== 'gitlab') return 'https://github.com'
  const url = new URL(typeof connection.config.baseUrl === 'string' && connection.config.baseUrl ? connection.config.baseUrl : 'https://gitlab.com')
  if (url.protocol !== 'https:') throw new Error('the GitLab base URL must be https')
  return url.origin + url.pathname.replace(/\/+$/, '')
}
