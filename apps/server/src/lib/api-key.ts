import { createHash, randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { ACCOUNT_LOCKED, accountLocked } from './oidc-session'
import { mayWorkIn } from './people'
import { isArchived } from './workspace-delete'

const o = { collection: 'bauherren', overrideAccess: true, depth: 0 } as const

export const hasApiKey = async (payload: Payload, id: number | string): Promise<boolean> =>
  !!(await payload.findByID({ ...o, id })).enableAPIKey

type Owner = { id: number | string }
const own = (user: Owner): number | string => {
  if (user?.id == null || user.id === '') throw new Error('A signed-in Bauherr is required.')
  return user.id
}

export const rotateApiKey = async (payload: Payload, user: Owner): Promise<string> => {
  const apiKey = randomBytes(32).toString('hex')
  await payload.update({ ...o, id: own(user), data: { enableAPIKey: true, apiKey } })
  return apiKey
}

export const revokeApiKey = async (payload: Payload, user: Owner): Promise<void> => {
  await payload.update({ ...o, id: own(user), data: { enableAPIKey: false } })
}

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex')
const ak = { collection: 'agent_keys', overrideAccess: true, depth: 0 } as const

export const mintAgentKey = async (
  payload: Payload,
  user: Owner,
  label: string,
  workspace: number,
): Promise<string> => {
  const person = await payload.findByID({ ...o, id: own(user) })
  if (await isArchived(payload, workspace)) throw new Error('That Workspace is deleted: restore it first.')
  if (!mayWorkIn(person, workspace)) throw new Error('You are not a member of that Workspace.')
  const token = `bha_${randomBytes(32).toString('hex')}`
  const data = {
    owner: own(user),
    workspace,
    label: label.trim() || 'agent',
    keyHash: hashOf(token),
    prefix: token.slice(0, 8),
  }
  await payload.create({ ...ak, data })
  return token
}

export const replaceAgentKey = async (
  payload: Payload,
  user: Owner,
  label: string,
  workspace: number,
): Promise<string> => {
  const where = {
    owner: { equals: own(user) },
    workspace: { equals: workspace },
    label: { equals: label },
    revokedAt: { exists: false },
  }
  const { docs } = await payload.find({ ...ak, where, pagination: false })
  for (const k of docs) await revokeAgentKey(payload, user, k.id)
  return mintAgentKey(payload, user, label, workspace)
}

export const revokeAgentKey = async (payload: Payload, user: Owner, keyId: number | string): Promise<void> => {
  const { docs } = await payload.find({
    ...ak,
    where: { id: { equals: keyId }, owner: { equals: own(user) } },
    limit: 1,
  })
  if (!docs[0]) throw new Error('No such agent key.')
  await payload.update({ ...ak, id: keyId, data: { revokedAt: new Date().toISOString() } })
}

type AgentKeyRow = { id: number; label: string; prefix: string; lastUsedAt?: string; revokedAt?: string }

export const listAgentKeys = async (payload: Payload, user: Owner, workspace: number): Promise<AgentKeyRow[]> =>
  (
    await payload.find({
      ...ak,
      where: { owner: { equals: own(user) }, workspace: { equals: workspace } },
      sort: '-createdAt',
      pagination: false,
    })
  ).docs as AgentKeyRow[]

type AgentKeyDoc = {
  id: number | string
  owner: number | string
  workspace: number | { id: number }
  revokedAt?: string | null
}

export const resolveAgentKey = async (
  payload: Payload,
  token: string,
): Promise<{ keyId: number | string; workspace: number; owner: Record<string, unknown> } | null> => {
  const { docs } = await payload.find({
    ...ak,
    where: { keyHash: { equals: hashOf(token) } },
    limit: 1,
    showHiddenFields: true,
  })
  const key = docs[0] as AgentKeyDoc | undefined
  if (!key || key.revokedAt) return null
  const owner = await payload.findByID({ ...o, id: key.owner }).catch(() => null)
  if (!owner) return null
  if (await accountLocked(payload, owner.id)) throw new Error(ACCOUNT_LOCKED)
  await payload.update({ ...ak, id: key.id, data: { lastUsedAt: new Date().toISOString() } })
  const workspace = Number(typeof key.workspace === 'object' ? key.workspace.id : key.workspace)
  return { keyId: key.id, workspace, owner: { ...owner, collection: 'bauherren' } }
}
