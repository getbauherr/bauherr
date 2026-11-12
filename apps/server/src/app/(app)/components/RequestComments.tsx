import { sourceOf } from '../../../lib/actions'
import { payloadClient } from '../lib/session'
import { ago } from '../lib/format'
import { forOwner } from '../lib/comments'
import { renderMarkdown } from '../lib/markdown'
import { within } from '../lib/overview'
import { Markdown } from './Markdown'

const COMMENTS_MS = 5000

/** The forge-backed Comments, streamed after the page; 5 s per Ticket, then "could not be reached". */
export async function Comments({ tickets, owner }: { tickets: { id: number; number: number }[]; owner: boolean }) {
  const payload = await payloadClient()
  let forgeError = false
  const comments = (
    await Promise.all(
      tickets.map(async (t) => {
        try {
          const { ts, n } = await sourceOf(payload, (await payload.findByID({ collection: 'tickets', id: t.id, depth: 0, overrideAccess: true })) as never)
          return (await within(ts.listComments(n), COMMENTS_MS)).filter((c) => owner ? forOwner(c.body) !== null : !c.body.startsWith('<!-- bauherr:')).map((c) => ({ ...c, body: owner ? forOwner(c.body)! : c.body, ticket: t.number }))
        } catch {
          forgeError = true
          return []
        }
      }),
    )
  ).flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <>
      {forgeError && <p className="small text-muted-foreground">The forge could not be reached; some comments are unavailable.</p>}
      {comments.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {comments.map((c) => (
            <li key={`${c.ticket}-${c.id}`} className="flex flex-col gap-1" data-testid="request-comment">
              <p className="small m-0 text-muted-foreground">#{c.ticket} · {c.author} · {ago(c.createdAt)}</p>
              <Markdown html={renderMarkdown(c.body)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No comments yet.</p>
      )}
    </>
  )
}
