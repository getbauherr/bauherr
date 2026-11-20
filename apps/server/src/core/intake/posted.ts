import type { StoredEvent } from '../record/store'

export const questionPostedAt = (events: StoredEvent[]): string | null => {
  const asked = events.findLastIndex((event) => event.type === 'intake.asked')
  if (asked < 0) return null
  const posted = events
    .slice(asked + 1)
    .find((event) => event.type === 'forge.write.done' && event.data.kind === 'question')
  return posted?.createdAt ?? null
}
