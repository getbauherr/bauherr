import { JAEGER_DEFAULT, proxyAdmin, TRACES_PREFIX } from '../../../lib/admin-proxy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handle = async (req: Request, { params }: { params: Promise<{ path?: string[] }> }): Promise<Response> =>
  proxyAdmin(
    req,
    {
      name: 'Traces',
      url: process.env.JAEGER_URL ?? JAEGER_DEFAULT,
      prefix: TRACES_PREFIX,
      writes: false,
      hint: 'Jaeger runs in the <code>observability</code> profile: start the stack with <code>--profile observability</code> and OTEL_ENABLED=1, then open <code>http://127.0.0.1:16686</code>.',
    },
    (await params).path,
  )

export { handle as GET, handle as HEAD, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
