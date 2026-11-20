import { z } from 'zod'

export type HookItem = { repo: string; kind: 'issue' | 'pr'; number: number }
export type HookHead = { repo: string; sha: string }
export type Reduced = { items: HookItem[]; heads: HookHead[] }

const NOTHING: Reduced = { items: [], heads: [] }

type Handler = (body: unknown) => Reduced

const handler =
  <T>(schema: z.ZodType<T>, reduce: (data: T) => Reduced): Handler =>
  (body) => {
    const parsed = schema.safeParse(body)
    return parsed.success ? reduce(parsed.data) : NOTHING
  }

const items = (repo: string, kind: HookItem['kind'], numbers: number[]): Reduced => ({
  items: numbers.map((number) => ({ repo, kind, number })),
  heads: [],
})

const head = (repo: string, sha: string): Reduced => ({ items: [], heads: [{ repo, sha }] })

const number = z.number().int().positive()
const repository = z.object({ full_name: z.string().min(1) })
const pullRequest = z.object({ number })
const pulls = z.array(pullRequest)

const issueEvent = z.object({ repository, issue: z.object({ number, pull_request: z.unknown().optional() }) })
const pullEvent = z.object({ repository, pull_request: pullRequest })
const checkRunEvent = z.object({ repository, check_run: z.object({ pull_requests: pulls }) })
const checkSuiteEvent = z.object({ repository, check_suite: z.object({ pull_requests: pulls }) })
const statusEvent = z.object({ repository, sha: z.string().min(1) })

const GITHUB = new Map<string, Handler>()
const issueHandler = handler(issueEvent, ({ repository: repo, issue }) =>
  items(repo.full_name, issue.pull_request === undefined ? 'issue' : 'pr', [issue.number]),
)
const pullHandler = handler(pullEvent, ({ repository: repo, pull_request: pull }) =>
  items(repo.full_name, 'pr', [pull.number]),
)
GITHUB.set('issues', issueHandler)
GITHUB.set('issue_comment', issueHandler)
GITHUB.set('pull_request', pullHandler)
GITHUB.set('pull_request_review', pullHandler)
GITHUB.set(
  'check_run',
  handler(checkRunEvent, ({ repository: repo, check_run: run }) =>
    items(repo.full_name, 'pr', run.pull_requests.map((pull) => pull.number)),
  ),
)
GITHUB.set(
  'check_suite',
  handler(checkSuiteEvent, ({ repository: repo, check_suite: suite }) =>
    items(repo.full_name, 'pr', suite.pull_requests.map((pull) => pull.number)),
  ),
)
GITHUB.set('status', handler(statusEvent, ({ repository: repo, sha }) => head(repo.full_name, sha)))

export const reduceGithub = (event: string, body: unknown): Reduced => GITHUB.get(event)?.(body) ?? NOTHING

const project = z.object({ path_with_namespace: z.string().min(1) })
const iid = z.object({ iid: number })

const gitlabIssue = z.object({ project, object_attributes: iid })
const gitlabNote = z.object({
  project,
  object_attributes: z.object({ noteable_type: z.string() }),
  issue: iid.optional(),
  merge_request: iid.optional(),
})
const gitlabPipeline = z.object({
  project,
  merge_request: iid.nullish(),
  object_attributes: z.object({ sha: z.string().min(1) }),
})

const GITLAB = new Map<string, Handler>()
GITLAB.set(
  'Issue Hook',
  handler(gitlabIssue, ({ project: repo, object_attributes: attributes }) =>
    items(repo.path_with_namespace, 'issue', [attributes.iid]),
  ),
)
GITLAB.set(
  'Merge Request Hook',
  handler(gitlabIssue, ({ project: repo, object_attributes: attributes }) =>
    items(repo.path_with_namespace, 'pr', [attributes.iid]),
  ),
)
GITLAB.set(
  'Note Hook',
  handler(gitlabNote, ({ project: repo, object_attributes: attributes, issue, merge_request: mergeRequest }) => {
    const path = repo.path_with_namespace
    if (attributes.noteable_type === 'Issue' && issue) return items(path, 'issue', [issue.iid])
    if (attributes.noteable_type === 'MergeRequest' && mergeRequest) return items(path, 'pr', [mergeRequest.iid])
    return NOTHING
  }),
)
GITLAB.set(
  'Pipeline Hook',
  handler(gitlabPipeline, ({ project: repo, merge_request: mergeRequest, object_attributes: attributes }) =>
    mergeRequest
      ? items(repo.path_with_namespace, 'pr', [mergeRequest.iid])
      : head(repo.path_with_namespace, attributes.sha),
  ),
)

export const reduceGitlab = (event: string, body: unknown): Reduced => GITLAB.get(event)?.(body) ?? NOTHING
