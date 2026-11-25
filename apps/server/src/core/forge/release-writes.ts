import type { Backend, Forge, Release } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { ProductObserving } from './errors'
import { loadProductRow, type ProductTarget } from './write-store'

export type NewRelease = { tag: string; sha: string; name: string; body: string }
export type DeployStart = { workflow: string; ref: string; inputs: Record<string, string> }
type Deps = { backend: (connection: number) => Promise<Backend> }

export const releaseWrites = (payload: Payload, deps: Deps) => {
  const forgeOf = async (target: ProductTarget): Promise<{ repo: string; forge: Forge }> => {
    const row = await loadProductRow(payload, target)
    if (row.productState !== 'active') {
      throw new ProductObserving(`Product ${row.productName} is observing: nothing is written to the forge.`)
    }
    return { repo: row.repo, forge: (await deps.backend(row.connection)).forge }
  }
  return {
    draftRelease: async (target: ProductTarget, input: NewRelease): Promise<Release> => {
      const { repo, forge } = await forgeOf(target)
      return forge.draftRelease(repo, input)
    },
    publishRelease: async (target: ProductTarget, id: string, body: string): Promise<Release> => {
      const { repo, forge } = await forgeOf(target)
      return forge.publishRelease(repo, id, { body })
    },
    startDeploy: async (target: ProductTarget, input: DeployStart): Promise<void> => {
      const { repo, forge } = await forgeOf(target)
      await forge.startDeploy(repo, input)
    },
  }
}
