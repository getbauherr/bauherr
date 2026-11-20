export const ago = (iso: string, now = Date.now()): string => {
  const m = Math.max(0, Math.round((now - +new Date(iso)) / 6e4))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export const duration = (sec: number): string => {
  const s = Math.max(0, sec)
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${(s / 86400).toFixed(1)} d`
}

export const usd = (n: number | null): string => (n == null ? '—' : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`)

export const exactTime = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
