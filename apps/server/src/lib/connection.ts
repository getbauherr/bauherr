
/** Decrypted Connection; the secret lives only in memory. */
export interface ConnectionInput {
  id: number | string
  kind: 'github' | 'llm-provider'
  config: Record<string, unknown>
  secret: string | null
  capabilities: Record<string, boolean>
}

