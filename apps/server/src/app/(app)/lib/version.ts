import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Server app version (`apps/server/package.json`). */
export const appVersion = (): string => JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version

/** Repo-root CHANGELOG.md; the Docker image copies the whole repo, so it ships with the app. */
export const changelog = (): string => readFileSync(path.resolve(process.cwd(), '../../CHANGELOG.md'), 'utf8')
