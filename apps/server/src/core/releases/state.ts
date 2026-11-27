import { sql } from '@payloadcms/db-postgres'
import type { Check, Release } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { ReadForge } from '../forge/reader'
import { releasesOnly, sortVersions } from '../readiness/release-facts'
import type { SourceRow } from '../mirror/source-store'

const MAX_VERSIONS = 20
const NOTES_MAX = 20_000
const PASSED = ['success', 'neutral', 'skipped']

export const releaseStateSchema = z.object({
  production: z.object({ sha: z.string(), tag: z.string().nullable() }).nullable(),
  staging: z.object({ sha: z.string(), checks: z.enum(['passing', 'failing', 'running', 'none']) }).nullable(),
  versions: z.array(
    z.object({ tag: z.string(), at: z.string().nullable(), notes: z.string(), url: z.string().nullable() }),
  ),
  olderAt: z.string().nullable().default(null),
})
export type ReleaseState = z.infer<typeof releaseStateSchema>
type Version = ReleaseState['versions'][number]

export const checksOf = (checks: Check[]): 'passing' | 'failing' | 'running' | 'none' => {
  if (checks.length === 0) return 'none'
  if (checks.some((check) => check.status !== 'completed')) return 'running'
  return checks.every((check) => PASSED.includes(check.conclusion ?? '')) ? 'passing' : 'failing'
}

const stampOf = async (repo: string, forge: ReadForge, release: Release | undefined, sha: string | null) => {
  const stamp = release?.createdAt ?? (sha ? await forge.getCommitDate(repo, sha) : null)
  return stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp).toISOString() : null
}

const stampOfTag = async (repo: string, forge: ReadForge, releases: Release[], tag: string) => {
  const release = releases.find((entry) => entry.tag === tag)
  const sha = release?.sha ?? (await forge.tagSha(repo, tag))
  return { release, sha, at: await stampOf(repo, forge, release, sha) }
}

const versionsOf = async (
  repo: string,
  forge: ReadForge,
): Promise<{ found: (Version & { sha: string | null })[]; olderAt: string | null }> => {
  const releases = await forge.listReleases(repo)
  const tags = [...new Set([...(await forge.listTags(repo)), ...releases.map((release) => release.tag)])]
  const sorted = sortVersions(releasesOnly(tags))
  const found: (Version & { sha: string | null })[] = []
  for (const tag of sorted.slice(0, MAX_VERSIONS)) {
    const { release, sha, at } = await stampOfTag(repo, forge, releases, tag)
    found.push({ tag, at, sha, notes: (release?.body ?? '').slice(0, NOTES_MAX), url: release?.url ?? null })
  }
  const older = sorted[MAX_VERSIONS]
  return { found, olderAt: older ? (await stampOfTag(repo, forge, releases, older)).at : null }
}

export const readReleaseState = async (repo: string, forge: ReadForge): Promise<ReleaseState> => {
  const { found, olderAt } = await versionsOf(repo, forge)
  const production = await forge.latestDeployment(repo, 'production')
  const staging = await forge.latestDeployment(repo, 'staging')
  return {
    production: production
      ? { sha: production.sha, tag: found.find((version) => version.sha === production.sha)?.tag ?? null }
      : null,
    staging: staging ? { sha: staging.sha, checks: checksOf(await forge.listChecks(repo, staging.sha)) } : null,
    versions: found.map(({ tag, at, notes, url }) => ({ tag, at, notes, url })),
    olderAt,
  }
}

export const refreshReleaseState = async (payload: Payload, source: SourceRow, forge: ReadForge): Promise<void> => {
  const state = await readReleaseState(source.repo, forge)
  await payload.db.drizzle.execute(sql`
    UPDATE "ticket_sources" SET "release_state" = ${JSON.stringify(state)}::jsonb, "updated_at" = now()
    WHERE "id" = ${source.id}`)
}
