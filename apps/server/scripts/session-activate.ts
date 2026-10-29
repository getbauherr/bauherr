import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const settings = join(homedir(), '.claude', 'settings.json')
const backup = `${settings}.bauherr-bak`
const keyFile = process.env.BAUHERR_SESSION_KEY_FILE ?? join(homedir(), '.config', 'bauherr', 'session-key')
const gateway = process.env.BAUHERR_GATEWAY_URL ?? 'http://127.0.0.1:4000'
const models = {
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'sub/claude-haiku-5-5',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'sub/claude-sonnet-5-5',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'sub/claude-opus-5-5',
}

const [, , cmd] = process.argv
if (cmd === 'activate') {
  if (existsSync(backup)) throw new Error(`already active (${backup} exists); run session:deactivate first`)
  const key = readFileSync(keyFile, 'utf8').trim()
  const current = existsSync(settings) ? JSON.parse(readFileSync(settings, 'utf8')) : {}
  if (existsSync(settings)) copyFileSync(settings, backup)
  else writeFileSync(backup, '{}\n')
  const next = { ...current, env: { ...current.env, ANTHROPIC_BASE_URL: gateway, ANTHROPIC_CUSTOM_HEADERS: `x-agw-key: ${key}`, ...models } }
  writeFileSync(`${settings}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  renameSync(`${settings}.tmp`, settings)
  console.info(`session mode active: ${gateway}; models ${Object.values(models).join(', ')}. Restart Claude Code; undo with pnpm session:deactivate`)
} else if (cmd === 'deactivate') {
  if (!existsSync(backup)) throw new Error(`nothing to restore (${backup} missing)`)
  renameSync(backup, settings)
  console.info('session mode off: settings restored')
} else {
  throw new Error('usage: session-activate.ts activate|deactivate')
}
