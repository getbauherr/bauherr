import { WAITING_FOR_YOU } from '../../../lib/checkpoints'
/** A model id without its provider prefix ("anthropic/claude-sonnet-5-5" is "claude-sonnet-5-5"); the full id belongs in a title attribute. */
export const shortModel = (id: string): string => id.replace(/^.*\//, '')

/** "5 min ago", "3 h ago", "2 d ago". */
export const ago = (iso: string): string => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 6e4))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export const STALE_MS = 5 * 6e4
/** "40s ago", "3m ago", "2h ago" plus whether it is older than the stale threshold. */
export const heartbeatAge = (iso: string, now = Date.now()): { text: string; stale: boolean } => {
  const ms = Math.max(0, now - +new Date(iso))
  const s = Math.round(ms / 1000)
  return { text: `${s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`} ago`, stale: ms > STALE_MS }
}

/** A span of seconds as "40 s", "35 min", "14 h", "2.1 d". */
export const duration = (sec: number): string => {
  const s = Math.max(0, sec)
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${(s / 86400).toFixed(1)} d`
}

/** "Waiting for you · 5 min": the status label of the Workflow view and how long the decision has been open. */
export const waited = (iso: string): string => `${WAITING_FOR_YOU} · ${ago(iso).replace(/ ago$/, '').replace('just now', 'a moment')}`

/** A span of seconds as "40 s", "35 min", "1 h 12 min". */
export const durationHm = (sec: number): string => {
  const s = Math.max(0, sec)
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}
