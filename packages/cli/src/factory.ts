import { readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { parse, stringify } from 'yaml'
import { CliError } from './preflight.js'

/** Parses the factory file and replaces every role's `profile_file` with `profile` (the file text), reading relative to the file's directory; a path outside it is refused. Returns the YAML to send. */
export const inlineProfiles = (yaml: string, dir: string): string => {
  const doc = parse(yaml) as { team?: { roles?: Record<string, { profile_file?: string; profile?: string }> } } | null
  for (const [id, role] of Object.entries(doc?.team?.roles ?? {})) {
    if (!role?.profile_file) continue
    const path = resolve(dir, role.profile_file)
    if (!path.startsWith(resolve(dir) + sep)) throw new CliError(`role "${id}": profile_file ${role.profile_file} must stay inside ${dir}`)
    role.profile = readFileSync(path, 'utf8')
    delete role.profile_file
  }
  return stringify(doc)
}

type Call = { url: string; workspace: string; key: string | undefined; fetch?: typeof fetch }
type Result = { ok: boolean; findings: string[]; version?: number; changed: boolean; migrated: { from: string; to: string; tickets: number; runs: number }[] }

const endpoint = ({ url, workspace }: Call, query = '') => `${url.replace(/\/$/, '')}/api/workspaces/${encodeURIComponent(workspace)}/factory${query}`

const send = async (c: Call, path: string, init: RequestInit): Promise<Response> => {
  if (!c.key) throw new CliError('Set BAUHERR_API_KEY to your personal API key (Settings > API key); an agent key cannot change the workflow.')
  const res = await (c.fetch ?? fetch)(path, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${c.key}`, 'x-bauherr-via': 'cli' } })
  if (res.status === 401 || res.status === 403 || res.status === 404) throw new CliError(`${res.status}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText}`)
  return res
}

/** Sends the factory file (profiles inlined); returns the printable result, throws a CliError listing the findings (exit code 1). */
export const applyFile = async (c: Call & { file: string; dryRun: boolean }): Promise<string> => {
  const text = inlineProfiles(readFileSync(c.file, 'utf8'), dirname(resolve(c.file)))
  const res = await send(c, endpoint(c, c.dryRun ? '?dryRun=1' : ''), { method: 'PUT', body: text, headers: { 'content-type': 'text/yaml' } })
  const r = (await res.json()) as Result
  if (!r.ok) throw new CliError(`${c.dryRun ? 'check' : 'apply'} failed:\n- ${r.findings.join('\n- ')}`)
  const moved = r.migrated.map((m) => `\n  ${m.from} -> ${m.to}: ${m.tickets} Ticket(s), ${m.runs} Run(s)`).join('')
  return c.dryRun ? `valid${r.changed ? '' : ' (no change)'}${moved}` : r.changed ? `applied: version ${r.version}${moved}` : `no change: version ${r.version} is already active`
}

/** The Workspace's active factory file. */
export const exportFile = async (c: Call): Promise<string> => (await send(c, endpoint(c), { method: 'GET' })).text()
