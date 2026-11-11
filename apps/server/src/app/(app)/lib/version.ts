import { readFileSync } from 'node:fs'
import path from 'node:path'

/** `YYYY-MM-DD HH:mm` (UTC) of an ISO 8601 build date, or undefined when it is missing or unreadable. */
const stamp = (iso?: string): string | undefined => {
  const t = iso ? new Date(iso) : undefined
  return t && !Number.isNaN(t.getTime()) ? t.toISOString().slice(0, 16).replace('T', ' ') : undefined
}

/**
 * What the footer and the release notes show. Release image (`BAUHERR_VERSION`, set by release.yml): `v1.2.3 · 2026-11-11`.
 * Other builds with a build date (`BAUHERR_BUILD_DATE`, UTC): `dev · 2026-11-11 16:42 UTC · 5a1112f`; without one `dev+<sha>`, or `dev`.
 * Formatted on the server in UTC, so server and client render the same text.
 */
export const appVersion = (): string => {
  const version = process.env.BAUHERR_VERSION
  const built = stamp(process.env.BAUHERR_BUILD_DATE)
  if (version && version !== 'dev') return [`v${version}`, built?.slice(0, 10)].filter(Boolean).join(' · ')
  const revision = process.env.BAUHERR_REVISION?.slice(0, 7)
  if (built) return ['dev', `${built} UTC`, revision].filter(Boolean).join(' · ')
  return revision ? `dev+${revision}` : 'dev'
}

/** Repo-root CHANGELOG.md; the Docker image copies the whole repo, so it ships with the app. */
export const changelog = (): string => readFileSync(path.resolve(process.cwd(), '../../CHANGELOG.md'), 'utf8')
