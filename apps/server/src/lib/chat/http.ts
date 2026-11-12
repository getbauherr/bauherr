import config from '@payload-config'
import { getPayload } from 'payload'
import { tenantsOf } from '../actions'
import { loadWorkflows } from '../factory'
import { assignmentOf, isBauherr, isProductOwner } from '../people'
import type { ChatEvent } from './engine'
import type { Who } from './threads'

type Doc = Record<string, any>
export const RUNS_PER_HOUR = 60
export const MAX_MESSAGE_CHARS = 8000
export const MAX_IMAGES = 6
export const MAX_MESSAGES = 100
const WS_COOKIE = 'bauherr-ws'

export const fail = (error: string, status: number): Response => Response.json({ error }, { status })

const cookie = (req: Request, name: string): string | undefined =>
  req.headers.get('cookie')?.split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.slice(1).join('=')

/** The signed-in person and their current Workspace (the `bauherr-ws` cookie, checked against their memberships; the first one without it), or a 401/404 Response. `owner`: a Product owner may call it too, in a Workspace they are assigned in (only the refinement turn route opens it). */
export const chatWho = async (req: Request, opts: { owner?: boolean } = {}): Promise<Who | Response> => {
  const payload = await getPayload({ config })
  await loadWorkflows(payload)
  const { user } = await payload.auth({ headers: req.headers })
  if (!user) return fail('unauthorized', 401)
  if (!isBauherr(user) && !(opts.owner && isProductOwner(user))) return fail('forbidden', 403)
  const u = user as Doc
  const slug = cookie(req, WS_COOKIE)
  const { docs } = await payload.find({ collection: 'workspaces', where: u.role === 'admin' ? {} : { id: { in: tenantsOf(u) } }, sort: 'name', pagination: false, depth: 0, overrideAccess: true })
  const mine = (docs as Doc[]).filter((d) => !isProductOwner(u) || assignmentOf(u, d.id))
  const w = mine.find((d) => d.slug === slug) ?? mine[0]
  return w ? { payload, user: u, workspace: w.id } : fail('no workspace', 404)
}

/** One JSON object per line; a client abort closes the generator. */
export const ndjson = (events: AsyncGenerator<ChatEvent>): Response => {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(c) {
        try {
          const { done, value } = await events.next()
          if (done) c.close()
          else c.enqueue(enc.encode(`${JSON.stringify(value)}\n`))
        } catch (e) {
          c.enqueue(enc.encode(`${JSON.stringify({ type: 'error', message: (e as Error).message })}\n`))
          c.close()
        }
      },
      async cancel() {
        await events.return(undefined)
      },
    }),
    { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } },
  )
}
