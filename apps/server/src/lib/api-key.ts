import { createHash, randomBytes } from 'node:crypto'
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

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex')
const ak = { collection: 'agent_keys', overrideAccess: true, depth: 0 } as const

/** Mints an agent key for `user` (prefix `bha_`, 32 random bytes). Only the sha256 is stored; the plaintext is returned once. */
export const mintAgentKey = async (payload: Payload, user: Owner, label: string): Promise<string> => {
  const token = `bha_${randomBytes(32).toString('hex')}`
  await payload.create({ ...ak, data: { owner: own(user), label: label.trim() || 'agent', keyHash: hashOf(token), prefix: token.slice(0, 8) } })
  return token
}

/** Revokes the owner's active keys with this label, then mints a fresh one (idempotent seeding). */
export const replaceAgentKey = async (payload: Payload, user: Owner, label: string): Promise<string> => {
  const { docs } = await payload.find({ ...ak, where: { owner: { equals: own(user) }, label: { equals: label }, revokedAt: { exists: false } }, pagination: false })
  for (const k of docs) await revokeAgentKey(payload, user, k.id)
  return mintAgentKey(payload, user, label)
}

/** Revokes one of the owner's agent keys; the id must belong to `user`. */
export const revokeAgentKey = async (payload: Payload, user: Owner, keyId: number | string): Promise<void> => {
  const { docs } = await payload.find({ ...ak, where: { id: { equals: keyId }, owner: { equals: own(user) } }, limit: 1 })
  if (!docs[0]) throw new Error('No such agent key.')
  await payload.update({ ...ak, id: keyId, data: { revokedAt: new Date().toISOString() } })
}

/** The owner's agent keys, newest first (never the hash). */
export const listAgentKeys = async (payload: Payload, user: Owner) =>
  (await payload.find({ ...ak, where: { owner: { equals: own(user) } }, sort: '-createdAt', pagination: false })).docs as unknown as { id: number; label: string; prefix: string; lastUsedAt?: string; revokedAt?: string }[]

/** Looks a bearer token up by hash; rejects unknown and revoked keys, touches `lastUsedAt`, returns the key and its owner. */
export const resolveAgentKey = async (payload: Payload, token: string): Promise<{ keyId: number | string; owner: Record<string, any> } | null> => {
  const { docs } = await payload.find({ ...ak, where: { keyHash: { equals: hashOf(token) } }, limit: 1, showHiddenFields: true })
  const key = docs[0] as unknown as { id: number | string; owner: number | string; revokedAt?: string | null } | undefined
  if (!key || key.revokedAt) return null
  const owner = (await payload.findByID({ ...o, id: key.owner }).catch(() => null)) as Record<string, any> | null
  if (!owner) return null
  await payload.update({ ...ak, id: key.id, data: { lastUsedAt: new Date().toISOString() } })
  return { keyId: key.id, owner: { ...owner, collection: 'bauherren' } }
}
