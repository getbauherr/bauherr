import type { Payload } from 'payload'
import { inLockedRecord } from '../conn'
import { appendEvent, readEvents } from '../record/store'
import { commentsOf, type RequestComment } from './comments'

export type NewComment = RequestComment

export const handOver = (payload: Payload, recordId: number, runId: number): Promise<NewComment[]> =>
  inLockedRecord(payload, recordId, async (tx) => {
    const events = await readEvents(tx, recordId)
    const given = events.reduce(
      (top, event) => (event.type === 'run.comments.delivered' ? Math.max(top, event.data.through) : top),
      0,
    )
    const fresh = events.filter((event) => event.type === 'request.commented' && event.id > given)
    const last = fresh.at(-1)
    if (!last) return []
    const comments = await commentsOf(tx, recordId, fresh)
    await appendEvent(tx, recordId, {
      type: 'run.comments.delivered',
      data: { runId: String(runId), through: last.id, count: comments.length },
      actor: 'factory',
    })
    return comments
  })
