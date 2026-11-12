import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const templates = new URL('../templates/', import.meta.url)
const envFile = (dir: string) => join(dir, '.env')

export const cliVersion = (): string =>
  (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

/** Repo-root compose.yaml turned into the installed one: image pinned, no build, no fixed db host port or container names, secrets from the env file. */
export const renderCompose = (template: string, version: string): string =>
  template
    .replace('${BAUHERR_VERSION:-dev}', version)
    .replace(/^  build:\n(?:    .*\n)+/m, '')
    .split('\n')
    .filter((l) => !/container_name:/.test(l) && !/ports: \["127\.0\.0\.1:(54330):/.test(l))
    .join('\n')
    .replace('PAYLOAD_SECRET_FILE: /run/secrets/payload_secret', 'PAYLOAD_SECRET: ${PAYLOAD_SECRET:?run bauherr init}')
    .replace('ENCRYPTION_KEY_FILE: /run/secrets/encryption_key', 'ENCRYPTION_KEY: ${ENCRYPTION_KEY:?run bauherr init}')

/** Compose project name derived from the install dir; the path hash keeps two `bauherr` dirs apart. */
export const projectName = (dir: string): string => {
  const abs = resolve(dir)
  const slug = basename(abs).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '') || 'bauherr'
  return `${slug}-${createHash('sha1').update(abs).digest('hex').slice(0, 6)}`
}

export const parseEnv = (text: string): Map<string, string> =>
  new Map([...text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm)].map((m) => [m[1]!, m[2]!]))

export const readEnv = (dir: string): Map<string, string> =>
  existsSync(envFile(dir)) ? parseEnv(readFileSync(envFile(dir), 'utf8')) : new Map()

type Settings = { PORT: string; GATEWAY_PORT: string; PUBLIC_URL: string }

/** Merges `values` over the existing env file (unknown keys survive); secrets are generated only when absent. */
export const writeEnv = (dir: string, values: Settings): Map<string, string> => {
  const env = readEnv(dir)
  env.set('COMPOSE_PROJECT_NAME', env.get('COMPOSE_PROJECT_NAME') ?? projectName(dir))
  env.set('PORT', values.PORT)
  env.set('GATEWAY_PORT', values.GATEWAY_PORT)
  env.set('PUBLIC_URL', values.PUBLIC_URL)
  for (const k of ['PAYLOAD_SECRET', 'ENCRYPTION_KEY']) if (!env.get(k)) env.set(k, randomBytes(32).toString('hex'))
  writeFileSync(envFile(dir), [...env].map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
  chmodSync(envFile(dir), 0o600)
  return env
}

export const writeProject = (dir: string, version: string, values: Settings): Map<string, string> => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'compose.yaml'), renderCompose(readFileSync(new URL('compose.yaml', templates), 'utf8'), version))
  cpSync(new URL('deploy/', templates), join(dir, 'deploy'), { recursive: true })
  return writeEnv(dir, values)
}
