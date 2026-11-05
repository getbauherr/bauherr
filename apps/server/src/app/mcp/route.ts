import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import config from '@payload-config'
import { getPayload } from 'payload'
import { resolveAgentKey } from '../../lib/api-key'
import { ACCOUNT_LOCKED, lockedRequests } from '../../lib/oidc-session'
import { callTool, tools, type Ctx } from '../../lib/mcp-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Factory MCP server (Streamable HTTP, stateless). Auth: `Authorization: Bearer <key>`; every tool acts as the key's Bauherr within their Workspaces.
 * An agent key (`bha_...`) is an `agent` actor and cannot use gate tools; only the Bauherr's personal API key is `human`. Anything else is a 401.
 */
const handle = async (req: Request): Promise<Response> => {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  const payload = await getPayload({ config })
  const headers = new Headers({ authorization: `bauherren API-Key ${token}` })
  let locked = false
  let agent: Awaited<ReturnType<typeof resolveAgentKey>> = null
  try {
    agent = token ? await resolveAgentKey(payload, token) : null
  } catch (e) {
    if (e instanceof Error && e.message === ACCOUNT_LOCKED) locked = true
    else throw e
  }
  const personal = token && !agent && !locked ? (await payload.auth({ headers, req: { headers } as never })).user : null
  locked ||= lockedRequests.has(headers)
  const user = agent?.owner ?? (personal?.collection === 'bauherren' ? personal : null)
  const actor: Ctx['actor'] = agent ? { kind: 'agent', keyId: agent.keyId } : { kind: 'human' }
  if (!user) {
    return Response.json({ jsonrpc: '2.0', error: { code: -32001, message: locked ? ACCOUNT_LOCKED : 'unauthorized' }, id: null }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }
  const server = new Server({ name: 'bauherr', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const out = await callTool({ payload, user: user as never, actor }, params.name, params.arguments)
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }
    }
  })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(req)
}

export { handle as GET, handle as POST, handle as DELETE }
