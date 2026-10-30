/** "5 min ago", "3 h ago", "2 d ago". */
export const ago = (iso: string): string => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 6e4))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
