import type { Payload } from 'payload'
import { decrypt } from './secrets'

const id = (v: unknown): number | string => (v && typeof v === 'object' ? (v as { id: number | string }).id : (v as number | string))

/** Decrypted Connection; the secret lives only in memory. */
export interface ConnectionInput {
  id: number | string
  kind: 'github' | 'llm-provider'
  config: Record<string, unknown>
  secret: string | null
  capabilities: Record<string, boolean>
}

/** Loads a Connection with its secret decrypted; the plaintext lives only in memory. */
export const connectionInput = async (payload: Payload, ref: unknown): Promise<ConnectionInput> => {
  const c = await payload.findByID({ collection: 'connections', id: id(ref), overrideAccess: true, showHiddenFields: true })
  const raw = (c as { secret?: string }).secret
  return {
    id: c.id,
    kind: c.kind,
    config: c.config ?? {},
    secret: raw ? decrypt(raw) : null,
    capabilities: c.capabilities ?? {},
  }
}
