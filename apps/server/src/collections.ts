import type { CollectionConfig } from 'payload'
import { coreCollections } from './core/collections'
import { agentKeys } from './collections/agent-keys'
import { bauherren } from './collections/bauherren'
import { connections } from './collections/connections'
import { repositories, ticketSources } from './collections/forge-collections'
import { products } from './collections/products'
import { agentSessions, humanTouches, instanceState, knowledgeChunks } from './collections/system-collections'
import { workspaces } from './collections/workspaces'

export { bauherrOnly, isAdmin } from './collections/access'

export const collections: CollectionConfig[] = [
  bauherren,
  agentKeys,
  workspaces,
  products,
  connections,
  repositories,
  ticketSources,
  knowledgeChunks,
  agentSessions,
  humanTouches,
  instanceState,
  ...coreCollections,
]
