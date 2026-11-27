export const ALERTS_PER_MINUTE = 30
const WINDOW_MS = 60_000

const windows = new Map<number, { used: number; reset: number }>()

export const allowAlerts = (product: number, now: number): boolean => {
  const current = windows.get(product)
  if (!current || now >= current.reset) {
    windows.set(product, { used: 1, reset: now + WINDOW_MS })
    return true
  }
  current.used += 1
  return current.used <= ALERTS_PER_MINUTE
}

export const resetAlertLimits = (): void => windows.clear()
