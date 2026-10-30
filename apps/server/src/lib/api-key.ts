import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

const o = { collection: 'bauherren', overrideAccess: true, depth: 0 } as const

/** Whether the Bauherr has an active MCP API key. */
export const hasApiKey = async (payload: Payload, id: number | string): Promise<boolean> =>
  !!((await payload.findByID({ ...o, id })) as unknown as { enableAPIKey?: boolean }).enableAPIKey

type Owner = { id: number | string }
const own = (user: Owner): number | string => {
  if (user?.id == null || user.id === '') throw new Error('A signed-in Bauherr is required.')
  return user.id
}

/** Replaces the signed-in Bauherr's API key (Payload encrypts it and refreshes the lookup index) and returns the plaintext once. Uses `overrideAccess` on purpose: Payload's `canCreateOrUpdateAPIKey` is admin-only and this is self-service; the only target is `user.id`. */
export const rotateApiKey = async (payload: Payload, user: Owner): Promise<string> => {
  const apiKey = randomBytes(32).toString('hex')
  await payload.update({ ...o, id: own(user), data: { enableAPIKey: true, apiKey } } as never)
  return apiKey
}

/** Disables the signed-in Bauherr's key; /mcp stops accepting it. Same `overrideAccess` exception as `rotateApiKey`. */
export const revokeApiKey = async (payload: Payload, user: Owner): Promise<void> => {
  await payload.update({ ...o, id: own(user), data: { enableAPIKey: false } } as never)
}
