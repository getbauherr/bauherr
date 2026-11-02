import { tenantsOf } from '../../../../lib/actions'
import { actor, SESSIONS_PER_USER_HOUR } from '../../../../lib/intake/api'
import { preflight, withCors } from '../../../../lib/intake/embed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Starts an Intake session for a Product of one of the caller's Workspaces. Body: `{ product }`; an embed token is bound to its Product and ignores the body. */
export const OPTIONS = preflight
export const POST = withCors(async (req: Request): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload, user, token } = a
  const body = (await req.json().catch(() => ({}))) as { product?: number | string }
  const wanted = token ? token.product : body.product
  const product = wanted ? ((await payload.findByID({ collection: 'products', id: wanted, depth: 0, overrideAccess: true }).catch(() => null)) as Record<string, any> | null) : null
  const workspace = product && (typeof product.workspace === 'object' ? product.workspace.id : product.workspace)
  if (!product || (user && user.role !== 'admin' && !tenantsOf(user).map(String).includes(String(workspace)))) return Response.json({ error: 'product not found' }, { status: 404 })
  const recent = await payload.count({ collection: 'intake_sessions', where: { and: [token ? { embedToken: { equals: token.id } } : { user: { equals: user!.id } }, { createdAt: { greater_than: new Date(Date.now() - 3_600_000).toISOString() } }] }, overrideAccess: true })
  if (recent.totalDocs >= (token ? Number(token.maxSessionsPerHour ?? SESSIONS_PER_USER_HOUR) : SESSIONS_PER_USER_HOUR)) return Response.json({ error: 'too many sessions' }, { status: 429 })
  const s = await payload.create({
    collection: 'intake_sessions',
    data: { product: product.id, workspace, persona: 'product-user', status: 'open', messages: [], ...(token ? { embedToken: token.id } : { user: user!.id }) },
    overrideAccess: true,
  })
  return Response.json({ id: s.id }, { status: 201 })
})
