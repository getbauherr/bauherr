import { describe, expect, it } from 'vitest'
import {
  agentsFile,
  branchProtection,
  checksNotStarted,
  ciRuns,
  describeChange,
  evaluate,
  issueForms,
  namesTestCommand,
  requiredChecks,
  riskAreas,
  sessions,
  type ReadinessFacts,
  type RepositoryFacts,
} from '../../src/core/readiness/checks'
import { settingData } from '../../src/core/readiness/fix'
import { suggestRiskAreas } from '../../src/core/readiness/suggest'

const repository = (change: Partial<RepositoryFacts> = {}): RepositoryFacts => ({
  branchProtected: 'yes',
  hasAgentsFile: true,
  agentsFile: '## Commands\n\n`pnpm test` runs the tests.',
  issueFormCount: 2,
  riskSuggestions: [],
  ...change,
})

const facts = (change: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  requiredChecks: ['test'],
  riskAreas: ['auth'],
  pulls: [{ checks: ['test', 'lint'] }, { checks: ['test'] }],
  repository: repository(),
  executor: 'session',
  rolesSeen: ['builder', 'reviewer', 'verifier'],
  waiting: [],
  releaseMode: 'direct',
  release: null,
  ...change,
})

describe('required-checks', () => {
  it('is ready when every required check ran on a recent pull request', () => {
    expect(requiredChecks(facts())).toMatchObject({ id: 'required-checks', status: 'ready' })
  })

  it('is a gap without required checks and proposes the names seen on the pull requests', () => {
    const found = requiredChecks(facts({ requiredChecks: [] }))
    expect(found).toMatchObject({ status: 'gap', title: 'No required checks' })
    expect(found.detail).toContain('lint, test')
    expect(found.fix).toEqual({
      kind: 'setting',
      label: 'Require these 2',
      change: { setting: 'required-checks', names: ['lint', 'test'] },
    })
  })

  it('is a gap without a fix when none is set and no check was seen', () => {
    expect(requiredChecks(facts({ requiredChecks: [], pulls: [{ checks: [] }] })).fix).toBeNull()
  })

  it('names a required check that ran on none of the recent pull requests', () => {
    const found = requiredChecks(facts({ requiredChecks: ['test', 'e2e'] }))
    expect(found).toMatchObject({ status: 'gap', title: 'Required check e2e has not run' })
    expect(found.fix).toMatchObject({ change: { names: ['lint', 'test'] } })
  })

  it('is unknown when checks are set and no pull request is mirrored', () => {
    expect(requiredChecks(facts({ pulls: [] })).status).toBe('unknown')
  })
})

describe('ci-runs', () => {
  it('is ready when a check ran', () => expect(ciRuns(facts()).status).toBe('ready'))

  it('is a gap with the ticket Run CI on pull requests when none of the pull requests has a check', () => {
    const found = ciRuns(facts({ pulls: [{ checks: [] }, { checks: [] }] }))
    expect(found.status).toBe('gap')
    expect(found.fix).toMatchObject({ kind: 'ticket', title: 'Run CI on pull requests' })
  })

  it('is unknown without pull requests', () => expect(ciRuns(facts({ pulls: [] })).status).toBe('unknown'))
})

describe('risk-areas', () => {
  it('is ready when areas are set', () => expect(riskAreas(facts()).status).toBe('ready'))

  it('is a gap that proposes the suggestions of the repository', () => {
    const sets = [{ name: 'auth', paths: ['src/auth/**'] }]
    const found = riskAreas(facts({ riskAreas: [], repository: repository({ riskSuggestions: sets }) }))
    expect(found.status).toBe('gap')
    expect(found.detail).toContain('auth (src/auth/**)')
    expect(found.fix).toEqual({ kind: 'setting', label: 'Review areas', change: { setting: 'risk-areas', sets } })
  })

  it('links to the settings when the repository suggests nothing or is not read', () => {
    expect(riskAreas(facts({ riskAreas: [] })).fix).toMatchObject({ kind: 'link', href: '#gates' })
    expect(riskAreas(facts({ riskAreas: [], repository: null })).fix).toMatchObject({ kind: 'link' })
  })
})

describe('agents-file', () => {
  const gap = (change: Partial<RepositoryFacts>) => agentsFile(facts({ repository: repository(change) }))

  it('is ready with a test command', () => expect(gap({}).status).toBe('ready'))

  it('is a gap without the file and with a file that names no test command', () => {
    expect(gap({ hasAgentsFile: false, agentsFile: null })).toMatchObject({ status: 'gap', title: 'No AGENTS.md' })
    const named = gap({ agentsFile: '# Project\n\nBe kind.' })
    expect(named).toMatchObject({ status: 'gap', title: 'AGENTS.md names no test command' })
    expect(named.fix).toMatchObject({ kind: 'ticket', title: 'Add an AGENTS.md with the build and test commands' })
  })

  it('is unknown while the repository facts are not read', () => {
    expect(agentsFile(facts({ repository: null })).status).toBe('unknown')
  })

  it('reads a code span or a line in a code block that contains test as the test command', () => {
    expect(namesTestCommand('Run `pnpm test` before a push.')).toBe(true)
    expect(namesTestCommand('```bash\npnpm test\n```')).toBe(true)
    expect(namesTestCommand('We test a lot.\n```bash\npnpm build\n```')).toBe(false)
  })
})

describe('issue-forms', () => {
  it('is ready with forms, a gap without and unknown before the facts are read', () => {
    expect(issueForms(facts()).status).toBe('ready')
    const none = issueForms(facts({ repository: repository({ issueFormCount: 0 }) }))
    expect(none.status).toBe('gap')
    expect(none.fix).toMatchObject({ kind: 'ticket', title: 'Add issue forms for bugs and changes' })
    expect(issueForms(facts({ repository: null })).status).toBe('unknown')
  })
})

describe('sessions', () => {
  it('is ready when each role was seen, and a gap that names the roles that were not', () => {
    expect(sessions(facts())?.status).toBe('ready')
    const found = sessions(facts({ rolesSeen: ['builder'] }))
    expect(found).toMatchObject({ status: 'gap', title: 'No reviewer, verifier session seen today' })
    expect(found?.fix).toEqual({ kind: 'link', label: 'Connect a session', href: '/settings/api-key' })
  })

  it('does not apply to a Runner Product', () => {
    expect(sessions(facts({ executor: 'runner', rolesSeen: [] }))).toBeNull()
    expect(evaluate(facts({ executor: 'runner' })).map((entry) => entry.id)).not.toContain('sessions')
  })
})

describe('branch-protection', () => {
  const of = (branchProtected: RepositoryFacts['branchProtected']) =>
    branchProtection(facts({ repository: repository({ branchProtected }) })).status

  it('is for information: on is ready, off a note, unknown stays unknown', () => {
    expect([of('yes'), of('no'), of('unknown')]).toEqual(['ready', 'note', 'unknown'])
    expect(branchProtection(facts({ repository: null })).status).toBe('unknown')
    expect(branchProtection(facts({ repository: repository({ branchProtected: 'no' }) })).fix).toBeNull()
  })
})

describe('checks-not-started', () => {
  it('is ready without a waiting ticket and a gap with the ticket and its wait', () => {
    expect(checksNotStarted(facts()).status).toBe('ready')
    const found = checksNotStarted(
      facts({
        waiting: [
          { recordId: 9, number: 643, waitedMinutes: 180 },
          { recordId: 10, number: 650, waitedMinutes: 70 },
        ],
      }),
    )
    expect(found.status).toBe('gap')
    expect(found.detail).toBe('2 tickets have waited up to 3 h for checks that have not started.')
    expect(found.fix).toEqual({ kind: 'link', label: 'Why', href: '/tickets/9' })
  })
})

describe('the list', () => {
  it('follows the order of the screen and never lists a check twice', () => {
    expect(evaluate(facts()).map((entry) => entry.id)).toEqual([
      'required-checks',
      'ci-runs',
      'risk-areas',
      'agents-file',
      'issue-forms',
      'sessions',
      'branch-protection',
      'checks-not-started',
    ])
  })
})

describe('the new value of a setting', () => {
  it('writes the checks as one comma separated value', () => {
    const none = { pathSets: {}, riskAreas: [] }
    expect(settingData({ setting: 'required-checks', names: ['lint', 'test'] }, none)).toEqual({
      requiredChecks: 'lint, test',
    })
    expect(describeChange({ setting: 'required-checks', names: ['lint', 'test'] })).toBe('lint, test')
  })

  it('adds the suggested sets without replacing a set of the same name and chooses them as areas', () => {
    const sets = [
      { name: 'auth', paths: ['src/auth/**'] },
      { name: 'infra', paths: ['infra/**'] },
    ]
    const change = { setting: 'risk-areas' as const, sets }
    expect(settingData(change, { pathSets: { auth: ['lib/auth/**'] }, riskAreas: [] })).toEqual({
      pathSets: { auth: ['lib/auth/**'], infra: ['infra/**'] },
      riskAreas: ['auth', 'infra'],
    })
    expect(describeChange(change)).toBe('auth: src/auth/**\ninfra: infra/**')
  })
})

describe('risk area suggestions from the repository tree', () => {
  const tree = [
    'README.md',
    'src/auth/login.ts',
    'src/auth/session/token.ts',
    'src/ui/button.ts',
    'db/migrations/001.sql',
    'db/migrations/002.sql',
    'infra/main.tf',
    'packages/billing/index.ts',
    'src/lib/deploy/run.ts',
    'src/deep/er/auth/x.ts',
    'docs/author-notes/a.md',
    'my dir/security/x.ts',
  ]

  it('takes top-level and second-level directories whose names start like a risky area', () => {
    expect(suggestRiskAreas(tree)).toEqual([
      { name: 'auth', paths: ['src/auth/**'] },
      { name: 'billing', paths: ['packages/billing/**'] },
      { name: 'infra', paths: ['infra/**'] },
      { name: 'migrations', paths: ['db/migrations/**'] },
    ])
  })

  it('gives nothing for a tree without such directories', () => {
    expect(suggestRiskAreas(['README.md', 'src/app/main.ts'])).toEqual([])
  })

  it('merges directories of one name into one set', () => {
    expect(suggestRiskAreas(['auth/a.ts', 'src/auth/b.ts'])).toEqual([
      { name: 'auth', paths: ['auth/**', 'src/auth/**'] },
    ])
  })
})
