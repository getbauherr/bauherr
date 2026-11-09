import type { Forge } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { parse } from 'yaml'
import { type MergeMode } from './merge-mode'
import { forgeOf } from './release'

export type Preflight = { ok: boolean; problems: string[]; at: string }
type Kind = 'github' | 'gitlab'
type Doc = Record<string, any>

const DEPLOYS = /deploy|publish|release/i
/** A job `if` that keeps the job off `merge_group` runs. */
const SKIPS_MERGE_GROUP = /event_name\s*(?:!=\s*['"]merge_group['"]|==\s*['"](?:push|pull_request|workflow_dispatch|release|issues)['"])/

/** Whether a required check context comes from the job `name` (matrix and reusable-workflow suffixes included). */
const produces = (context: string, name: string): boolean => {
  const base = name.replace(/\$\{\{[^}]*\}\}/g, '').trim()
  return context === name || context === base || context.startsWith(`${base} (`) || context.endsWith(` / ${base}`) || (base !== name && context.startsWith(base))
}

/** GitHub Actions workflow problems that stall or misfire the merge queue; pure. `required` are the check names the branch requires. */
export const checkWorkflows = (files: { path: string; content: string }[], required: string[]): string[] => {
  const problems: string[] = []
  for (const { path, content } of files) {
    let doc: Doc
    try {
      doc = (parse(content) as Doc) ?? {}
    } catch {
      problems.push(`${path}: not valid YAML, cannot check it for the merge_group trigger.`)
      continue
    }
    const on = doc.on
    const triggers = new Set(typeof on === 'string' ? [on] : Array.isArray(on) ? on : on && typeof on === 'object' ? Object.keys(on) : [])
    const jobs = Object.entries((doc.jobs ?? {}) as Record<string, Doc>).map(([key, job]) => ({ key, name: String(job?.name ?? key), skips: SKIPS_MERGE_GROUP.test(String(job?.if ?? '')) }))
    if (!triggers.has('merge_group') && (triggers.has('pull_request') || triggers.has('push')) && jobs.some((j) => required.some((c) => produces(c, j.name)))) {
      problems.push(`${path}: produces a required check but has no merge_group trigger; add "merge_group:" under "on:".`)
    }
    if (triggers.has('merge_group')) {
      for (const j of jobs.filter((x) => DEPLOYS.test(x.name) && !x.skips)) problems.push(`${path}: job "${j.key}" would deploy or publish on merge_group; add "if: github.event_name != 'merge_group'" to it.`)
    }
  }
  return problems
}

/** GitLab: the CI file itself must run pipelines for merge request events (merged results, trains); pure. */
export const checkGitlabCi = (content: string | null): string[] =>
  content === null ? ['no .gitlab-ci.yml on the default branch.'] : content.includes('merge_request_event') ? [] : ['.gitlab-ci.yml has no merge_request_event rules; add them so pipelines run for merged results and merge trains.']

/** Whether the repo can run in `queue` mode: the forge has a native queue and its CI is set up for it. A failed read of the repo is thrown, not reported as a problem. */
export const preflightQueue = async (forge: Forge, repo: string, kind: Kind, at = new Date().toISOString()): Promise<Preflight> => {
  if (!(await forge.queueSupport(repo))) {
    return { ok: false, at, problems: [kind === 'gitlab' ? 'Merge trains and merged-results pipelines are not both enabled for the project.' : 'The default branch has no merge queue (a repository ruleset with the merge queue rule).'] }
  }
  let problems: string[]
  if (kind === 'gitlab') {
    problems = checkGitlabCi(await forge.getFile(repo, '.gitlab-ci.yml').then((f) => f.content, () => null))
  } else {
    const paths = (await forge.listFiles(repo)).paths.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))
    const files = await Promise.all(paths.map(async (path) => ({ path, content: (await forge.getFile(repo, path)).content })))
    problems = checkWorkflows(files, await forge.requiredChecks(repo, (await forge.getRepository(repo)).defaultBranch))
  }
  return { ok: problems.length === 0, problems, at }
}

/** `queue` when the forge has a native queue and the preflight passes, else `train`. */
export const detectMergeMode = async (forge: Forge, repo: string, kind: Kind): Promise<{ mode: MergeMode; preflight: Preflight }> => {
  const preflight = await preflightQueue(forge, repo, kind)
  return { mode: preflight.ok ? 'queue' : 'train', preflight }
}

const failure = (e: unknown): Preflight => ({ ok: false, at: new Date().toISOString(), problems: [`Could not check the repository: ${e instanceof Error ? e.message : String(e)}`] })

/** Preflight of the Product's repo, stored on the Product; a forge failure is stored as the problem. */
export const runPreflight = async (payload: Payload, product: number | string): Promise<Preflight> => {
  const preflight = await forgeOf(payload, product).then(({ backend, repo, kind }) => preflightQueue(backend.forge, repo, kind)).catch(failure)
  await payload.update({ collection: 'products', id: product, data: { mergePreflight: preflight }, overrideAccess: true })
  return preflight
}

/** Detects the merge mode of the Product's repo and stores mode and preflight. A forge failure keeps the current mode and stores the problem (onboarding never blocks, D7 of #280). */
export const redetectMergeMode = async (payload: Payload, product: number | string): Promise<void> => {
  const found = await forgeOf(payload, product).then(({ backend, repo, kind }) => detectMergeMode(backend.forge, repo, kind)).catch(failure)
  await payload.update({ collection: 'products', id: product, data: 'mode' in found ? { mergeMode: found.mode, mergePreflight: found.preflight } : { mergePreflight: found }, overrideAccess: true })
}
