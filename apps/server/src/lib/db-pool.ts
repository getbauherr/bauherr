export const envInt = (env: Record<string, string | undefined>, name: string, fallback: number, min = 1): number => {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${name} must be ${min > 0 ? 'a positive' : 'a non-negative'} integer, got "${raw}"`)
  return n
}

export const poolOptions = (env: Record<string, string | undefined> = process.env) => ({
  max: envInt(env, 'DATABASE_POOL_MAX', 20),
  connectionTimeoutMillis: envInt(env, 'DATABASE_POOL_TIMEOUT_MS', 10_000),
  idleTimeoutMillis: 30_000,
})
