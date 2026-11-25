import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { parseAllDocuments } from 'yaml'
import { z } from 'zod'
import type { ReadForge } from '../forge/reader'
import type { SourceRow } from '../mirror/store'

export const releaseFactsSchema = z.object({
  stagingWorkflow: z.string().nullable(),
  productionWorkflow: z.string().nullable(),
  versionInput: z.string().nullable(),
  stagingAddress: z.string().nullable(),
  commitEndpoint: z.boolean().nullable(),
  lastVersion: z.string().nullable(),
  canWrite: z.boolean(),
})
export type ReleaseFacts = z.infer<typeof releaseFactsSchema>

export type Workflow = { path: string; environments: string[]; inputs: string[]; stagingOnDefault: boolean }

const WORKFLOW_FILE = /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml)$/
const VERSION_INPUTS = ['version', 'tag', 'sha', 'ref', 'release_version', 'version_tag', 'commit_sha']
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

const environmentName = (value: unknown): string | null => {
  const name = typeof value === 'string' ? value : record(value).name
  return typeof name === 'string' ? name : null
}

const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === 'string')

const matchesBranch = (patterns: string[], branch: string): boolean =>
  patterns.some((pattern) => pattern === branch || pattern === '*' || pattern === '**')

const pushesToDefault = (on: unknown, branch: string): boolean => {
  if (typeof on === 'string' || Array.isArray(on)) return list(on).includes('push')
  const triggers = record(on)
  if (!('push' in triggers)) return false
  const push = record(triggers.push)
  if ('branches' in push && !matchesBranch(list(push.branches), branch)) return false
  return !('branches-ignore' in push && matchesBranch(list(push['branches-ignore']), branch))
}

const startsOnDefault = (rule: Record<string, unknown>, branch: string): boolean => {
  if (rule.when === 'never' || rule.when === 'manual') return false
  if (typeof rule.if !== 'string') return true
  return rule.if.includes(branch) || rule.if.includes('CI_DEFAULT_BRANCH')
}

const jobRunsOnDefault = (job: Record<string, unknown>, branch: string): boolean => {
  if (Array.isArray(job.rules)) return job.rules.some((rule) => startsOnDefault(record(rule), branch))
  if (job.when === 'manual') return false
  if (job.only === undefined) return true
  const refs = list(Array.isArray(job.only) || typeof job.only === 'string' ? job.only : record(job.only).refs)
  return refs.includes('branches') || matchesBranch(refs, branch)
}

export const versionInputOf = (inputs: string[]): string | null =>
  inputs.find((name) => VERSION_INPUTS.includes(name.toLowerCase())) ?? null

export const workflowOf = (path: string, source: string, defaultBranch: string): Workflow => {
  const documents = parseAllDocuments(source).map((document) => record(document.toJS()))
  const environments: string[] = []
  const inputs: string[] = []
  let stagingOnDefault = false
  for (const document of documents) {
    inputs.push(...Object.keys(record(record(record(document.on).workflow_dispatch).inputs)))
    inputs.push(...Object.keys(record(record(document.spec).inputs)))
    for (const job of Object.values(record(document.jobs ?? document))) {
      const name = environmentName(record(job).environment)
      if (name === null) continue
      environments.push(name)
      inputs.push(...Object.keys(record(record(job).variables)))
      if (name !== 'staging') continue
      stagingOnDefault ||=
        document.jobs === undefined
          ? jobRunsOnDefault(record(job), defaultBranch)
          : pushesToDefault(document.on, defaultBranch)
    }
  }
  return { path, environments, inputs, stagingOnDefault }
}

const compareVersions = (a: RegExpExecArray, b: RegExpExecArray): number => {
  for (const at of [1, 2, 3]) {
    const difference = Number(a[at]) - Number(b[at])
    if (difference !== 0) return difference
  }
  if (a[4] === undefined || b[4] === undefined) return Number(a[4] === undefined) - Number(b[4] === undefined)
  return a[4].localeCompare(b[4], 'en', { numeric: true })
}

export const isVersion = (name: string): boolean => SEMVER.test(name)

export const sortVersions = (names: string[]): string[] => {
  const versions = names.flatMap((name) => {
    const match = SEMVER.exec(name)
    return match ? [{ name, match }] : []
  })
  return versions.sort((a, b) => compareVersions(b.match, a.match)).map((version) => version.name)
}

export const highestVersion = (names: string[]): string | null => sortVersions(names)[0] ?? null

const readWorkflows = async (repo: string, branch: string, forge: ReadForge): Promise<Workflow[]> => {
  const { paths } = await forge.listFiles(repo, branch)
  const workflows: Workflow[] = []
  for (const path of paths.filter((entry) => WORKFLOW_FILE.test(entry))) {
    try {
      workflows.push(workflowOf(path, (await forge.getFile(repo, path, branch)).content, branch))
    } catch {
      continue
    }
  }
  return workflows
}

const stagingFacts = async (repo: string, forge: ReadForge) => {
  const deployment = await forge.latestDeployment(repo, 'staging')
  const address = deployment?.url ?? null
  const answers = deployment && address ? await forge.commitEndpoint(repo, { url: address, sha: deployment.sha }) : null
  return { address, answers }
}

const lastVersionOf = async (repo: string, forge: ReadForge): Promise<string | null> => {
  const releases = await forge.listReleases(repo)
  return highestVersion([...(await forge.listTags(repo)), ...releases.map((release) => release.tag)])
}

export const readReleaseFacts = async (repo: string, forge: ReadForge): Promise<ReleaseFacts> => {
  const { defaultBranch } = await forge.getRepository(repo)
  const workflows = await readWorkflows(repo, defaultBranch, forge)
  const staging = workflows.find((workflow) => workflow.stagingOnDefault)
  const production = workflows.find((workflow) => workflow.environments.includes('production'))
  const { address, answers } = await stagingFacts(repo, forge)
  return {
    stagingWorkflow: staging?.path ?? null,
    productionWorkflow: production?.path ?? null,
    versionInput: versionInputOf(production?.inputs ?? []),
    stagingAddress: address,
    commitEndpoint: answers,
    lastVersion: await lastVersionOf(repo, forge),
    canWrite: await forge.canWrite(repo),
  }
}

export const refreshReleaseFacts = async (payload: Payload, source: SourceRow, forge: ReadForge): Promise<void> => {
  const facts = await readReleaseFacts(source.repo, forge)
  await payload.db.drizzle.execute(sql`
    UPDATE "ticket_sources" SET "release_facts" = ${JSON.stringify(facts)}::jsonb, "updated_at" = now()
    WHERE "id" = ${source.id}`)
}
