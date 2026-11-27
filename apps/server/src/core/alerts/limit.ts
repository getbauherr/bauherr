export const ALERTS_PER_MINUTE = 30
const WINDOW_MS = 60_000

const windows = new Map<number, { used: number; reset: number }>()

export const allowAlerts = (product: number, now: number, count: number): boolean => {
  const current = windows.get(product)
  if (!current || now >= current.reset) {
    windows.set(product, { used: count, reset: now + WINDOW_MS })
    return count <= ALERTS_PER_MINUTE
  }
  current.used += count
  return current.used <= ALERTS_PER_MINUTE
}

export const resetAlertLimits = (): void => windows.clear()
