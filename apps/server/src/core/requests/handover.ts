import type { Payload } from 'payload'
import { inLockedRecord, type Conn } from '../conn'
import { appendEvent, readEvents } from '../record/store'
import { commentsOf, type RequestComment } from './comments'

export type NewComment = RequestComment

export const unseenComments = async (db: Conn, recordId: number): Promise<NewComment[]> => {
  const events = await readEvents(db, recordId)
  const given = events.reduce(
    (top, event) => (event.type === 'run.comments.delivered' ? Math.max(top, event.data.through) : top),
    0,
  )
  return commentsOf(
    db,
    recordId,
    events.filter((event) => event.type === 'request.commented' && event.id > given),
  )
}

const record = async (db: Conn, recordId: number, runId: number, comments: NewComment[]) => {
  const last = comments.at(-1)
  if (!last) return
  await appendEvent(db, recordId, {
    type: 'run.comments.delivered',
    data: { runId: String(runId), through: last.id, count: comments.length },
    actor: 'factory',
  })
}

export const markDelivered = (payload: Payload, recordId: number, runId: number, comments: NewComment[]) =>
  inLockedRecord(payload, recordId, (tx) => record(tx, recordId, runId, comments))

export const handOver = (payload: Payload, recordId: number, runId: number): Promise<NewComment[]> =>
  inLockedRecord(payload, recordId, async (tx) => {
    const comments = await unseenComments(tx, recordId)
    await record(tx, recordId, runId, comments)
    return comments
  })
