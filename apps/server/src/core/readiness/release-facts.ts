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

export type Workflow = { path: string; environments: string[]; inputs: string[] }

const WORKFLOW_FILE = /^(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml)$/
const VERSION_INPUT = /version|tag|sha|ref/i
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

const environmentName = (value: unknown): string | null => {
  const name = typeof value === 'string' ? value : record(value).name
  return typeof name === 'string' ? name : null
}

export const workflowOf = (path: string, source: string): Workflow => {
  const documents = parseAllDocuments(source).map((document) => record(document.toJS()))
  const environments: string[] = []
  const inputs: string[] = []
  for (const document of documents) {
    inputs.push(...Object.keys(record(record(record(document.on).workflow_dispatch).inputs)))
    inputs.push(...Object.keys(record(record(document.spec).inputs)))
    for (const job of Object.values(record(document.jobs ?? document))) {
      const name = environmentName(record(job).environment)
      if (name === null) continue
      environments.push(name)
      inputs.push(...Object.keys(record(record(job).variables)))
    }
  }
  return { path, environments, inputs }
}

const compareVersions = (a: RegExpExecArray, b: RegExpExecArray): number => {
  for (const at of [1, 2, 3]) {
    const difference = Number(a[at]) - Number(b[at])
    if (difference !== 0) return difference
  }
  if (a[4] === undefined || b[4] === undefined) return Number(a[4] === undefined) - Number(b[4] === undefined)
  return a[4].localeCompare(b[4], 'en', { numeric: true })
}

export const highestVersion = (names: string[]): string | null => {
  const versions = names.flatMap((name) => {
    const match = SEMVER.exec(name)
    return match ? [{ name, match }] : []
  })
  versions.sort((a, b) => compareVersions(b.match, a.match))
  return versions[0]?.name ?? null
}

const readWorkflows = async (repo: string, branch: string, forge: ReadForge): Promise<Workflow[]> => {
  const { paths } = await forge.listFiles(repo, branch)
  const workflows: Workflow[] = []
  for (const path of paths.filter((entry) => WORKFLOW_FILE.test(entry))) {
    try {
      workflows.push(workflowOf(path, (await forge.getFile(repo, path, branch)).content))
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
  const staging = workflows.find((workflow) => workflow.environments.includes('staging'))
  const production = workflows.find((workflow) => workflow.environments.includes('production'))
  const { address, answers } = await stagingFacts(repo, forge)
  return {
    stagingWorkflow: staging?.path ?? null,
    productionWorkflow: production?.path ?? null,
    versionInput: production?.inputs.find((name) => VERSION_INPUT.test(name)) ?? null,
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
