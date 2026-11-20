import { chown, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const dir = () => process.env.GATEWAY_CONFIG_DIR ?? '/gateway'
export const providerFile = (ws: string, conn: string, ext: 'key' | 'json' = 'key') =>
  join(dir(), 'providers', `ws-${ws}.${conn}.${ext}`)

export const writeSecretFile = async (path: string, value: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, { mode: 0o600 })
  if (process.getuid?.() === 0) {
    const { uid, gid } = await stat(dirname(path))
    await chown(path, uid, gid)
  }
}

export const writeProvider = async (
  ws: string,
  conn: string,
  secret: string,
  ext: 'key' | 'json' = 'key',
): Promise<void> => {
  await mkdir(join(dir(), 'providers'), { recursive: true })
  const tmp = `${providerFile(ws, conn, ext)}.tmp`
  await writeFile(tmp, secret, { mode: 0o600 })
  await rename(tmp, providerFile(ws, conn, ext))
}

export const removeProvider = (ws: string, conn: string, ...exts: ('key' | 'json')[]) =>
  Promise.all(
    (exts.length ? exts : (['key', 'json'] as const)).map((e) => rm(providerFile(ws, conn, e), { force: true })),
  )

export const removeWorkspaceProviders = async (ws: string): Promise<void> => {
  const files = await readdir(join(dir(), 'providers')).catch(() => [] as string[])
  await Promise.all(
    files
      .filter((f) => f.startsWith(`ws-${ws}.`) && /^[a-z0-9-]+\.(key|json)$/.test(f.slice(`ws-${ws}.`.length)))
      .map((f) => rm(join(dir(), 'providers', f), { force: true })),
  )
}
