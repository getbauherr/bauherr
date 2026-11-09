/** pg pool sizing from env: `DATABASE_POOL_MAX` (default 20), `DATABASE_POOL_TIMEOUT_MS` (default 10000), so an exhausted pool fails a request instead of hanging. */
export const poolOptions = (env: Record<string, string | undefined> = process.env) => {
  const int = (name: string, fallback: number): number => {
    const raw = env[name]?.trim()
    if (!raw) return fallback
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`)
    return n
  }
  return { max: int('DATABASE_POOL_MAX', 20), connectionTimeoutMillis: int('DATABASE_POOL_TIMEOUT_MS', 10_000), idleTimeoutMillis: 30_000 }
}
