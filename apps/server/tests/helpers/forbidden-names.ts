import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './comments'

export type ForbiddenHit = { file: string; name: string }

export const FORBIDDEN_NAMES_VAR = 'BAUHERR_FORBIDDEN_NAMES'

export const ALLOWLIST: Record<string, string> = {}

export const FORBIDDEN_MESSAGE =
  'Use a neutral name (example.com, acme) or read the value from configuration. ' +
  `The list comes from the ${FORBIDDEN_NAMES_VAR} variable.`

export function parseForbidden(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean)
}

export function readText(file: string): string | null {
  const buf = readFileSync(join(repoRoot, file))
  return buf.includes(0) ? null : buf.toString('utf8')
}

export function scanForbidden(
  files: string[],
  read: (file: string) => string | null,
  forbidden: string[],
  allowlist: Record<string, string> = ALLOWLIST,
): ForbiddenHit[] {
  return files
    .filter((file) => !(file in allowlist))
    .flatMap((file) => {
      const haystack = `${file}\n${read(file) ?? ''}`.toLowerCase()
      return forbidden.filter((name) => haystack.includes(name)).map((name) => ({ file, name }))
    })
}
