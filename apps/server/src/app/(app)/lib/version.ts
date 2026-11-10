import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Release version from the image (`BAUHERR_VERSION`, set by release.yml); other builds show `dev+<sha>`. */
export const appVersion = (): string => {
  const version = process.env.BAUHERR_VERSION
  if (version && version !== 'dev') return version
  const revision = process.env.BAUHERR_REVISION?.slice(0, 7)
  return revision ? `dev+${revision}` : 'dev'
}

/** Repo-root CHANGELOG.md; the Docker image copies the whole repo, so it ships with the app. */
export const changelog = (): string => readFileSync(path.resolve(process.cwd(), '../../CHANGELOG.md'), 'utf8')
