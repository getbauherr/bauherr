import { WAITING_FOR_YOU } from '../../../lib/checkpoints'
export const shortModel = (id: string): string => id.replace(/^.*\//, '')

export const ago = (iso: string, now = Date.now()): string => {
  const m = Math.max(0, Math.round((now - +new Date(iso)) / 6e4))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export const STALE_MS = 5 * 6e4
export const heartbeatAge = (iso: string, now = Date.now()): { text: string; stale: boolean } => {
  const ms = Math.max(0, now - +new Date(iso))
  const s = Math.round(ms / 1000)
  return { text: `${s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`} ago`, stale: ms > STALE_MS }
}

export const duration = (sec: number): string => {
  const s = Math.max(0, sec)
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${(s / 86400).toFixed(1)} d`
}

export const waited = (iso: string): string => `${WAITING_FOR_YOU} · ${ago(iso).replace(/ ago$/, '').replace('just now', 'a moment')}`

export const durationHm = (sec: number): string => {
  const s = Math.max(0, sec)
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

export const usd = (n: number | null): string => (n == null ? '—' : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`)
export const tok = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)))
