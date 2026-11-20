'use server'
import { mintAgentKey, revokeAgentKey, revokeApiKey, rotateApiKey } from '../../../../lib/api-key'
import { backendFor } from '../../../../lib/adapters'
import { connectionInput } from '../../../../lib/connection'
import * as bauherren from '../../lib/bauherren-handlers'
import * as connections from '../../lib/connection-handlers'
import * as products from '../../lib/product-handlers'
import * as workspaces from '../../lib/workspace-handlers'
import { act, ctx, id, inWorkspace, inWs, s, type Ctx } from '../../lib/action-context'
import { listRepos, only } from '../../lib/settings'

const githubKnows = async (c: Ctx, login: string): Promise<boolean> => {
  const first = (
    await c.payload.find({
      collection: 'connections',
      where: { and: [{ workspace: { equals: inWorkspace(c) } }, { kind: { equals: 'github' } }] },
      sort: 'id',
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0]
  if (!first) return true
  try {
    return await backendFor(await connectionInput(c.payload, first.id), { maxRetries: 0, timeoutMs: 10_000 })
      .tickets('')
      .userExists(login)
  } catch {
    return true
  }
}

export const saveGeneral = act({}, workspaces.saveGeneral)

export const saveModels = act({ budgetUsd30d: 'budgetAmount', budgetTokens30d: 'budgetAmount' }, workspaces.saveModels)

export const savePathSets = act({ sets: 'sets' }, products.savePathSets)

export const rotateWorkspaceKey = act({}, workspaces.rotateWorkspaceKey)

export const updatePricesNow = act({}, workspaces.updatePricesNow)

export const addRepository = act({}, products.addRepository)

export async function repositoriesOf(connection: number): Promise<string[] | null> {
  const c = await ctx()
  only(c.user)
  await inWs(c, 'connections', Number(connection))
  return listRepos(Number(connection))
}

export const createProductWithRepo = act({}, products.createProductWithRepo)

export const removeDoc = act({}, products.removeDoc)

export const saveConnection = act({}, connections.saveConnection)

export const verifyConnection = act({}, connections.verifyConnection)

export const createBauherr = act({}, bauherren.createBauherr)

export const createProductOwner = act({}, bauherren.createProductOwner)

export const saveAssignment = act({}, bauherren.saveAssignment)

export const changeRole = act({}, bauherren.changeRole)

export const saveBauherr = act({}, bauherren.saveBauherr(githubKnows))

export const unlockBauherr = act({}, bauherren.unlockBauherr)

export const createWorkspace = act({}, workspaces.createWorkspace)

export const deleteWorkspace = act({}, workspaces.deleteWorkspace)

export const restoreWorkspaceAction = act({}, workspaces.restoreWorkspace)

export const mintOwnAgentKey = act({}, async ({ user, workspace, payload }, fd) =>
  mintAgentKey(payload, user, s(fd, 'label'), inWorkspace({ workspace })),
)

export const revokeOwnAgentKey = act({}, async ({ user, payload }, fd) => revokeAgentKey(payload, user, id(fd)))

export const rotateOwnKey = act({}, async ({ user, payload }) => rotateApiKey(payload, user))

export const revokeOwnKey = act({}, async ({ user, payload }) => revokeApiKey(payload, user))
