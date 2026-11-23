import { z } from 'zod'
import { advance } from '../../src/core/engine'
import type { Modules } from '../../src/core/module'
import { callTool } from '../../src/core/run/mcp/registry'
import type { Contexts } from '../../src/core/run/mcp/tool'
import { mintAgentKey, resolveAgentKey, rotateApiKey } from '../../src/lib/api-key'
import { openEngine, TEST_MODULES, type Engine } from './harness'

export const ORIGIN = 'http://factory.test'

export type Member = { id: number; agentToken: string; personalKey: string; keyId: number }

export type Mcp = {
  e: Engine
  alpha: Member
  beta: Member
  agent: (member: Member) => Pick<Contexts, 'agent'>
  person: (member: Member, workspaces: number[]) => Pick<Contexts, 'person'>
  call: (name: string, raw: unknown, contexts: Partial<Contexts>) => Promise<unknown>
  begin: (workspace?: number) => Promise<number>
  claimed: (
    member: Member,
    role?: string,
  ) => Promise<{ session: string; runId: number; leaseToken: string; context: { note: string | null } }>
}

const idOf = (doc: { id: number | string }) => z.coerce.number().parse(doc.id)

export const openMcp = async (suite: string, modules: Modules = TEST_MODULES): Promise<Mcp> => {
  const e = await openEngine(suite, modules)
  const { payload } = e.db
  const make = async (name: string, workspace: number): Promise<Member> => {
    const user = await payload.create({
      collection: 'bauherren',
      data: { email: `${name}@x.io`, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: workspace }] },
      overrideAccess: true,
    })
    const agentToken = await mintAgentKey(payload, user, 'agent', workspace)
    const resolved = await resolveAgentKey(payload, agentToken)
    return {
      id: idOf(user),
      agentToken,
      personalKey: await rotateApiKey(payload, user),
      keyId: z.coerce.number().parse(resolved?.keyId),
    }
  }
  const alpha = await make('alpha', e.db.workspace)
  const beta = await make('beta', e.db.otherWorkspace)
  const mcp: Mcp = {
    e,
    alpha,
    beta,
    agent: (member) => ({
      agent: {
        deps: e.deps(),
        workspace: member === alpha ? e.db.workspace : e.db.otherWorkspace,
        keyId: member.keyId,
        origin: ORIGIN,
      },
    }),
    person: (member, workspaceIds) => ({
      person: { deps: e.deps(), person: { id: String(member.id), role: 'bauherr', workspaceIds } },
    }),
    call: (name, raw, contexts) => callTool(name, raw, contexts),
    begin: async (workspace) => {
      const id = await e.db.fresh(workspace)
      await advance(id, e.deps())
      return id
    },
    claimed: async (member, role = 'builder') => {
      const { session } = z
        .object({ session: z.string() })
        .parse(await mcp.call('connect', { role }, mcp.agent(member)))
      const work = z
        .object({ runId: z.number(), leaseToken: z.string(), context: z.object({ note: z.string().nullable() }) })
        .parse(await mcp.call('next_work', { session }, mcp.agent(member)))
      return { session, ...work }
    },
  }
  return mcp
}
