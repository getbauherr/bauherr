import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { expect, it } from 'vitest'

type Step = { uses?: string; with?: Record<string, string>; env?: Record<string, string> }
type Job = { env?: Record<string, string>; steps: Step[] }

const workflow = parse(readFileSync(join(__dirname, '..', '..', '..', '.github', 'workflows', 'release.yml'), 'utf8')) as {
  jobs: Record<string, Job>
}
const npmJob = workflow.jobs.npm
const setupNode = npmJob.steps.find((step) => step.uses?.startsWith('actions/setup-node@'))

it('the npm job setup-node step has no registry-url (OIDC trusted publishing writes no token)', () => {
  expect(Object.keys(setupNode?.with ?? {})).not.toContain('registry-url')
})

it('the npm job sets no NODE_AUTH_TOKEN or NPM_TOKEN, at job or step level', () => {
  const envNames = [npmJob.env ?? {}, ...npmJob.steps.map((step) => step.env ?? {})].flatMap((env) => Object.keys(env))
  expect(envNames.filter((name) => name === 'NODE_AUTH_TOKEN' || name === 'NPM_TOKEN')).toEqual([])
})
