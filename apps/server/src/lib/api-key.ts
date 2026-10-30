import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

const o = { collection: 'bauherren', overrideAccess: true, depth: 0 } as const

/** Whether the Bauherr has an active MCP API key. */
export const hasApiKey = async (payload: Payload, id: number | string): Promise<boolean> =>
  !!((await payload.findByID({ ...o, id })) as unknown as { enableAPIKey?: boolean }).enableAPIKey

/** Replaces the Bauherr's API key (Payload encrypts it and refreshes the lookup index) and returns the plaintext once. The only target is `id`; callers pass the signed-in Bauherr. */
export const rotateApiKey = async (payload: Payload, id: number | string): Promise<string> => {
  const apiKey = randomBytes(32).toString('hex')
  await payload.update({ ...o, id, data: { enableAPIKey: true, apiKey } } as never)
  return apiKey
}

/** Disables the key; /mcp stops accepting it. */
export const revokeApiKey = async (payload: Payload, id: number | string): Promise<void> => {
  await payload.update({ ...o, id, data: { enableAPIKey: false } } as never)
}
