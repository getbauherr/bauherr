import config from '@payload-config'
import { getPayload } from 'payload'
import { resolveAgentKey } from '../../../../../lib/api-key'
import { applyFactory, exportFactory, loadWorkflows } from '../../../../../lib/factory'
import { personOf } from '../../../../../lib/person'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const err = (status: number, error: string) => Response.json({ error }, { status })

/** The Admin behind the request: a session cookie or the personal API key (`Authorization: Bearer`). An agent key (`bha_...`) is refused (403): it must never change the workflow. */
const admin = async (req: Request, slug: string) => {
  const payload = await getPayload({ config })
  await loadWorkflows(payload)
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (token && (await resolveAgentKey(payload, token))) return err(403, 'an agent key cannot change the workflow')
  const headers = token ? new Headers({ authorization: `bauherren API-Key ${token}` }) : req.headers
  const user = (await payload.auth({ headers, req: { headers } as never })).user as { collection?: string; role?: string; email?: string } | null
  if (user?.collection !== 'bauherren') return err(401, 'unauthorized')
  if (user.role !== 'admin') return err(403, 'only an Admin can change the workflow')
  const ws = (await payload.find({ collection: 'workspaces', where: { slug: { equals: slug } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  return ws ? { payload, user: user as { email: string }, workspace: ws.id as number } : err(404, `no Workspace "${slug}"`)
}

export const GET = async (req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> => {
  const a = await admin(req, (await params).slug)
  if (a instanceof Response) return a
  return new Response(await exportFactory(a.payload, a.workspace), { headers: { 'content-type': 'text/yaml; charset=utf-8' } })
}

/** Body = the factory file; `?dryRun=1` checks only; `If-Match: <version>` refuses when the active version moved. Answers `applyFactory`'s result (422 on findings, 409 when stale). */
export const PUT = async (req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> => {
  const a = await admin(req, (await params).slug)
  if (a instanceof Response) return a
  const match = req.headers.get('if-match')
  const result = await applyFactory(a.payload, a.workspace, await req.text(), {
    by: personOf(a.user),
    via: req.headers.get('x-bauherr-via') === 'cli' ? 'cli' : 'api',
    dryRun: new URL(req.url).searchParams.get('dryRun') === '1',
    ...(match !== null && { baseVersion: Number(match.replaceAll('"', '')) || null }),
  })
  return Response.json(result, { status: result.ok ? 200 : result.findings.includes('the workflow changed since you loaded it') ? 409 : 422 })
}
