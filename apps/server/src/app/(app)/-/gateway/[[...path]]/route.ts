import { proxyAdmin } from '../../../lib/admin-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handle = async (req: Request, { params }: { params: Promise<{ path?: string[] }> }): Promise<Response> =>
  proxyAdmin(
    req,
    {
      name: 'Gateway',
      url: process.env.GATEWAY_ADMIN_URL,
      redact: true,
      writes: process.env.GATEWAY_ADMIN_PROXY_WRITE === '1',
      hint: 'The gateway admin port is not published. On the host run <code>docker compose port gateway 15000</code> to find the local port, or set GATEWAY_ADMIN_URL.',
    },
    (await params).path,
  )

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
