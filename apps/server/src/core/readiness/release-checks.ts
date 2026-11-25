import type { CheckId, Fix, Finding, ReadinessFacts, Status } from './checks'
import type { ReleaseFacts } from './release-facts'

export const RELEASE_CHECK_IDS = [
  'release-staging-deploy',
  'release-staging-address',
  'release-production-deploy',
  'release-version-input',
  'release-commit-endpoint',
  'release-last-version',
  'release-rights',
] as const satisfies readonly CheckId[]

const NOT_READ = 'The release facts are not read yet. The daily check reads them.'
const UNREAD_TITLES = [
  'Staging deploy not read yet',
  'Staging address not read yet',
  'Production deploy not read yet',
  'Version input not read yet',
  'Version endpoint not read yet',
  'Last version not read yet',
  'Rights not read yet',
]

const entry = (id: CheckId, status: Status, title: string, detail: string, fix: Fix | null = null): Finding => ({
  id,
  status,
  title,
  detail,
  fix,
})

const ticket = (title: string, ask: string): Fix => ({ kind: 'ticket', label: 'Make it a ticket', title, ask })

const gap = (id: CheckId, title: string, detail: string, fix: Fix): Finding => entry(id, 'gap', title, detail, fix)

const stagingDeploy = (id: CheckId, workflow: string | null): Finding =>
  workflow === null
    ? gap(
        id,
        'Staging does not deploy on every merge',
        'No workflow runs a job with the environment staging on every push to the default branch. ' +
          'A job started by hand or on another branch does not count, ' +
          'so nobody can try a merge before a release.',
        ticket(
          'Deploy staging on every merge to the default branch',
          'Add a workflow that deploys to the environment staging on every push to the default branch, ' +
            'with the staging address as the environment url.',
        ),
      )
    : entry(id, 'ready', 'Staging deploys on every merge', `Workflow ${workflow}, environment staging.`)

const stagingAddress = (id: CheckId, address: string | null): Finding =>
  address === null
    ? gap(
        id,
        'Staging has no address',
        'No deployment of the environment staging reports an address to open.',
        ticket(
          'Report the staging address from the staging deployment',
          'Make the staging deploy job report the address of the staging site as the environment url ' +
            'of its deployment.',
        ),
      )
    : entry(id, 'ready', 'Staging address', address)

const productionDeploy = (id: CheckId, workflow: string | null): Finding =>
  workflow === null
    ? gap(
        id,
        'No workflow deploys to production',
        'No workflow has a job with the environment production for the factory to start.',
        ticket(
          'Add a production deploy the factory can start',
          'Add a workflow that deploys to the environment production, can be started by hand, ' +
            'and deploys the build that ran on staging.',
        ),
      )
    : entry(id, 'ready', 'Production deploys from a workflow', `Workflow ${workflow}, environment production.`)

const versionInput = (id: CheckId, facts: ReleaseFacts): Finding => {
  if (facts.productionWorkflow === null) {
    return entry(id, 'unknown', 'Version input not checked', 'It needs the production workflow first.')
  }
  if (facts.versionInput !== null) {
    return entry(id, 'ready', 'Production deploy takes a version', `Input ${facts.versionInput}, no rebuild needed.`)
  }
  return gap(
    id,
    'Production deploy takes no version',
    `${facts.productionWorkflow} has no input for a version, tag or commit, ` +
      'so it would rebuild instead of deploying the staging build.',
    ticket(
      'Let the production deploy take a version',
      'Add an input named version to the production workflow and make it deploy the existing build ' +
        'of that version without a rebuild.',
    ),
  )
}

const commitEndpoint = (id: CheckId, answers: boolean | null): Finding => {
  if (answers === null) {
    return entry(id, 'unknown', 'Version endpoint not checked', 'It needs the staging address first.')
  }
  if (answers) return entry(id, 'ready', 'Staging shows its commit', 'The staging address answers with the commit.')
  return gap(
    id,
    'Version endpoint missing',
    'Staging and production must show which commit they run, for example at /api/health. ' +
      'Without it the factory cannot verify a deploy.',
    ticket(
      'Show the running commit at /api/health',
      'Add an endpoint such as /api/health that answers with the version and the commit the site was built from.',
    ),
  )
}

const lastVersion = (id: CheckId, version: string | null): Finding =>
  version === null
    ? gap(
        id,
        'No version found',
        'Neither a tag nor a release with a semantic version exists, so the factory cannot name the next one.',
        ticket('Tag the first version', 'Tag the current release as v0.1.0 so the factory can count from it.'),
      )
    : entry(id, 'ready', 'Last version found', `${version} (tags and releases).`)

const rights = (id: CheckId, allowed: boolean): Finding =>
  allowed
    ? entry(id, 'ready', 'The factory may start workflows and write releases', '')
    : gap(
        id,
        'The factory may not write to the repository',
        'The connection has no write access, so it cannot start the production workflow or write a release.',
        ticket(
          'Give the factory write access',
          'Give the account behind the factory connection write access to this repository.',
        ),
      )

export const releaseChecks = (f: ReadinessFacts): Finding[] => {
  if (f.releaseMode === 'direct') return []
  const [stagingId, addressId, productionId, inputId, endpointId, versionId, rightsId] = RELEASE_CHECK_IDS
  const facts = f.release
  if (facts === null) {
    return RELEASE_CHECK_IDS.map((id, at) => entry(id, 'unknown', UNREAD_TITLES[at] ?? id, NOT_READ))
  }
  return [
    stagingDeploy(stagingId, facts.stagingWorkflow),
    stagingAddress(addressId, facts.stagingAddress),
    productionDeploy(productionId, facts.productionWorkflow),
    versionInput(inputId, facts),
    commitEndpoint(endpointId, facts.commitEndpoint),
    lastVersion(versionId, facts.lastVersion),
    rights(rightsId, facts.canWrite),
  ]
}

export const releaseBlocked = (findings: Finding[]): boolean =>
  findings.some((finding) => RELEASE_CHECK_IDS.some((id) => id === finding.id) && finding.status !== 'ready')
