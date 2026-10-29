import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import config from '@payload-config'
import { getPayload } from 'payload'
import { callTool, tools } from '../../lib/mcp-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Factory MCP server (Streamable HTTP, stateless). Auth: `Authorization: Bearer <API key of a bauherren user>`;
 * every tool acts as that Bauherr within their Workspaces.
 */
const handle = async (req: Request): Promise<Response> => {
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  const payload = await getPayload({ config })
  const user = token ? (await payload.auth({ headers: new Headers({ authorization: `bauherren API-Key ${token}` }) })).user : null
  if (!user || user.collection !== 'bauherren') {
    return Response.json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
  }
  const server = new Server({ name: 'bauherr', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const out = await callTool({ payload, user: user as never }, params.name, params.arguments)
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
