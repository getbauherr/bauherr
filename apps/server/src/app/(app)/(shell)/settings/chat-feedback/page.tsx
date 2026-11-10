import { notFound } from 'next/navigation'
import { chatFeedback } from '../../../../../lib/chat/insights'
import { EmptyState } from '../../../components/EmptyState'
import { Table } from '../../../components/ui/table'
import { Tab, Tabs } from '../../../components/ui/tabs'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'

export const dynamic = 'force-dynamic'

const when = (at: string) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

export default async function ChatFeedback({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { rating: r } = await searchParams
  const rating = r === 'up' || r === 'down' ? r : undefined
  const rows = (await chatFeedback(await payloadClient(), workspace.id, { limit: 200 })).filter((x) => !rating || x.value === rating)
  return (
    <>
      <h2 className="heading">Chat feedback</h2>
      <Tabs aria-label="Rating">
        <Tab href="/settings/chat-feedback" aria-current={!rating ? 'page' : undefined}>All</Tab>
        <Tab href="/settings/chat-feedback?rating=down" aria-current={rating === 'down' ? 'page' : undefined}>Thumbs down</Tab>
        <Tab href="/settings/chat-feedback?rating=up" aria-current={rating === 'up' ? 'page' : undefined}>Thumbs up</Tab>
      </Tabs>
      {!rows.length ? (
        <EmptyState text="No rated answers yet." />
      ) : (
        <Table className="min-w-[960px]">
          <thead><tr className="label"><th>When</th><th>Who</th><th>Rating</th><th>Reasons</th><th>Note</th><th>Question</th><th>Answer</th><th>Tools</th><th>Model</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.threadId}-${r.messageId}`} data-rating={r.value}>
                <td className="mono whitespace-nowrap">{when(r.at)}</td>
                <td>{r.rater ?? '—'}</td>
                <td><span className={r.value === 'down' ? 'text-destructive' : 'text-ok'}>{r.value === 'down' ? 'Down' : 'Up'}</span></td>
                <td>{r.reasons.join(', ') || '—'}</td>
                <td className="min-w-40 max-w-64 wrap-anywhere">{r.note ?? '—'}</td>
                <td className="min-w-40 max-w-64 wrap-anywhere"><div className="line-clamp-3">{r.question || '—'}</div></td>
                <td className="min-w-48 max-w-80 wrap-anywhere"><div className="line-clamp-3">{r.answer || '—'}</div></td>
                <td>{r.tools.length ? r.tools.map((t, i) => <span key={i} className={t.ok ? undefined : 'text-destructive'}>{i ? ', ' : ''}{t.name}</span>) : '—'}</td>
                <td>{r.usage?.model ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="small text-muted-foreground">Newest 200 rated answers of this Workspace.</p>
    </>
  )
}
