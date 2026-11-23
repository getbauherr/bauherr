import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import config from '@payload-config'
import { getPayload, type Payload } from 'payload'
import { z } from 'zod'
import { AGENT_INSTRUCTIONS } from '../../core/run/mcp/instructions'
import { callTool, TOOLS } from '../../core/run/mcp/registry'
import type { Contexts } from '../../core/run/mcp/tool'
import { engineDeps } from '../../jobs/engine-deps'
import { MODULES, skillFor, tierFor } from '../../lean'
import { resolveAgentKey } from '../../lib/api-key'
import { publicUrl } from '../../lib/oidc'
import { ACCOUNT_LOCKED, lockedRequests } from '../../lib/oidc-session'
import { isArchived } from '../../lib/workspace-delete'
import { isBauherr, mayWorkIn, tenantIds } from '../../lib/people'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const refuse = (status: 401 | 403, message: string): Response =>
  Response.json(
    { jsonrpc: '2.0', error: { code: status === 401 ? -32001 : -32003, message }, id: null },
    { status, headers: status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {} },
  )

const textOf = (error: unknown): string => {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || '(input)'}: ${issue.message}`).join('; ')
  }
  return error instanceof Error ? error.message : String(error)
}

const authenticate = async (payload: Payload, token: string): Promise<Partial<Contexts> | Response> => {
  const deps = { ...engineDeps(payload), modules: MODULES, skills: skillFor, tiers: tierFor }
  const agent = await resolveAgentKey(payload, token).catch((error: unknown) => {
    if (error instanceof Error && error.message === ACCOUNT_LOCKED) return null
    throw error
  })
  if (agent) {
    const member = isBauherr(agent.owner) && mayWorkIn(agent.owner, agent.workspace)
    if (!member || (await isArchived(payload, agent.workspace))) return refuse(401, 'unauthorized')
    return { agent: { deps, workspace: agent.workspace, keyId: Number(agent.keyId), origin: publicUrl() } }
  }
  const headers = new Headers({ authorization: `bauherren API-Key ${token}` })
  const { user } = await payload.auth({ headers })
  if (!user || user.collection !== 'bauherren' || lockedRequests.has(headers)) return refuse(401, 'unauthorized')
  const person = { id: String(user.id), role: String(user.role), workspaceIds: tenantIds(user) }
  return { person: { deps, person } }
}

const handle = async (req: Request): Promise<Response> => {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!token) return refuse(401, 'unauthorized')
  const contexts = await authenticate(await getPayload({ config }), token)
  if (contexts instanceof Response) return contexts
  const server = new Server(
    { name: 'bauherr', version: '0.1.0' },
    { capabilities: { tools: {} }, ...(contexts.agent ? { instructions: AGENT_INSTRUCTIONS } : {}) },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.filter((tool) => contexts[tool.access]).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...z.toJSONSchema(tool.input, { io: 'input' }), type: 'object' as const },
    })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const result = await callTool(params.name, params.arguments ?? {}, contexts)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: textOf(error) }] }
    }
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(req)
}

export { handle as DELETE, handle as GET, handle as POST }
