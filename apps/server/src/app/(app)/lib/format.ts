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
