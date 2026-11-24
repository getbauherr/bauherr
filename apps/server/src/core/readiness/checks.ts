import type { BranchProtection } from '../mirror/facts'
import type { RiskSuggestion } from './suggest'

export const CHECK_IDS = [
  'required-checks',
  'ci-runs',
  'risk-areas',
  'agents-file',
  'issue-forms',
  'sessions',
  'branch-protection',
  'checks-not-started',
] as const
export type CheckId = (typeof CHECK_IDS)[number]

export const RECENT_PULLS = 10
export const SESSION_ROLES = ['builder', 'reviewer', 'verifier'] as const

export type Change =
  | { setting: 'required-checks'; names: string[] }
  | { setting: 'risk-areas'; sets: RiskSuggestion[] }

export type Fix =
  | { kind: 'setting'; label: string; change: Change }
  | { kind: 'ticket'; label: string; title: string; ask: string }
  | { kind: 'link'; label: string; href: string }

export type Status = 'ready' | 'gap' | 'unknown' | 'note'
export type Finding = { id: CheckId; status: Status; title: string; detail: string; fix: Fix | null }

export type RepositoryFacts = {
  branchProtected: BranchProtection
  hasAgentsFile: boolean
  agentsFile: string | null
  issueFormCount: number
  riskSuggestions: RiskSuggestion[] | null
}

export type WaitingTicket = { recordId: number; number: number; waitedMinutes: number }

export type ReadinessFacts = {
  requiredChecks: string[]
  riskAreas: string[]
  pulls: { checks: string[] }[]
  repository: RepositoryFacts | null
  executor: 'session' | 'runner'
  rolesSeen: string[]
  waiting: WaitingTicket[]
}

const SETTINGS_RISK = '#gates'
const AGENTS_TITLE = 'Add an AGENTS.md with the build and test commands'
const NO_PULLS = 'No pull request is mirrored yet.'
const NOT_READ = 'The repository facts are not read yet.'

const finding = (id: CheckId, status: Status, title: string, detail = '', fix: Fix | null = null): Finding => ({
  id,
  status,
  title,
  detail,
  fix,
})

const ready = (id: CheckId, title: string): Finding => finding(id, 'ready', title)
const unknown = (id: CheckId, title: string, detail: string): Finding => finding(id, 'unknown', title, detail)
const gap = (id: CheckId, title: string, detail: string, fix: Fix | null): Finding =>
  finding(id, 'gap', title, detail, fix)

const unique = (names: string[]): string[] => [...new Set(names)]
const listOf = (names: string[]): string => names.join(', ')
const seenOn = (pulls: ReadinessFacts['pulls']): string[] => unique(pulls.flatMap((pull) => pull.checks)).sort()

const requiring = (seen: string[]): Fix | null =>
  seen.length === 0
    ? null
    : { kind: 'setting', label: `Require these ${seen.length}`, change: { setting: 'required-checks', names: seen } }

export const requiredChecks = (f: ReadinessFacts): Finding => {
  const seen = seenOn(f.pulls)
  if (f.requiredChecks.length === 0) {
    const ran = seen.length === 0 ? '' : ` The repository runs ${seen.length} on pull requests: ${listOf(seen)}.`
    const detail = `The factory merges as soon as Verify passes, without waiting for CI.${ran}`
    return gap('required-checks', 'No required checks', detail, requiring(seen))
  }
  if (f.pulls.length === 0) return unknown('required-checks', 'Required checks not compared yet', NO_PULLS)
  const missing = f.requiredChecks.filter((name) => !seen.includes(name))
  if (missing.length === 0) return ready('required-checks', `required checks that ran (${f.requiredChecks.length})`)
  const detail = `It ran on none of the last ${RECENT_PULLS} pull requests, so Verify may wait for it forever.`
  return gap('required-checks', `Required check ${listOf(missing)} has not run`, detail, requiring(seen))
}

const CI_TICKET: Fix = {
  kind: 'ticket',
  label: 'Make it a ticket',
  title: 'Run CI on pull requests',
  ask: 'Add a workflow that builds the project and runs its tests and lint on every pull request.',
}

export const ciRuns = (f: ReadinessFacts): Finding => {
  if (f.pulls.length === 0) return unknown('ci-runs', 'CI not compared yet', NO_PULLS)
  if (seenOn(f.pulls).length > 0) return ready('ci-runs', 'CI runs on pull requests')
  const detail = `No check ran on any of the last ${f.pulls.length} pull requests.`
  return gap('ci-runs', 'No CI on pull requests', detail, CI_TICKET)
}

const suggestionText = (sets: RiskSuggestion[]): string =>
  sets.map((set) => `${set.name} (${listOf(set.paths)})`).join(', ')

export const riskAreas = (f: ReadinessFacts): Finding => {
  if (f.riskAreas.length > 0) return ready('risk-areas', `risk areas (${f.riskAreas.length})`)
  const sets = f.repository?.riskSuggestions ?? []
  const detail = 'Every Brief without another reason is approved by the rule.'
  if (sets.length === 0) {
    return gap('risk-areas', 'No risk areas', detail, { kind: 'link', label: 'Set risk areas', href: SETTINGS_RISK })
  }
  const fix: Fix = { kind: 'setting', label: 'Review areas', change: { setting: 'risk-areas', sets } }
  return gap('risk-areas', 'No risk areas', `${detail} Suggested from the repository: ${suggestionText(sets)}.`, fix)
}

const TEST_SPAN = /`[^`\n]*test[^`\n]*`/i

export const namesTestCommand = (text: string): boolean => {
  let fenced = false
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    else if (TEST_SPAN.test(line) || (fenced && /test/i.test(line))) return true
  }
  return false
}

const AGENTS_TICKET: Fix = {
  kind: 'ticket',
  label: 'Make it a ticket',
  title: AGENTS_TITLE,
  ask:
    'Write an AGENTS.md at the repository root: what the project is, the commands to install, build, lint ' +
    'and test it, and where things live. Keep it short: only what the code cannot say.',
}

export const agentsFile = (f: ReadinessFacts): Finding => {
  const repo = f.repository
  if (repo === null) return unknown('agents-file', 'AGENTS.md not read yet', NOT_READ)
  if (!repo.hasAgentsFile) {
    const detail = 'Agents learn the build and test commands from scratch on every run.'
    return gap('agents-file', 'No AGENTS.md', detail, AGENTS_TICKET)
  }
  if (repo.agentsFile !== null && !namesTestCommand(repo.agentsFile)) {
    const detail = 'Agents have to find out how to run the tests on every run.'
    return gap('agents-file', 'AGENTS.md names no test command', detail, AGENTS_TICKET)
  }
  return ready('agents-file', 'AGENTS.md with a test command')
}

const FORMS_TICKET: Fix = {
  kind: 'ticket',
  label: 'Make it a ticket',
  title: 'Add issue forms for bugs and changes',
  ask: 'Add issue forms for a bug report and a change request that ask for the facts an agent needs.',
}

export const issueForms = (f: ReadinessFacts): Finding => {
  const repo = f.repository
  if (repo === null) return unknown('issue-forms', 'Issue forms not read yet', NOT_READ)
  if (repo.issueFormCount > 0) return ready('issue-forms', `issue forms (${repo.issueFormCount})`)
  const detail = 'Reporters write issues without the facts an agent needs.'
  return gap('issue-forms', 'No issue forms', detail, FORMS_TICKET)
}

export const sessions = (f: ReadinessFacts): Finding | null => {
  if (f.executor !== 'session') return null
  const missing = SESSION_ROLES.filter((role) => !f.rolesSeen.includes(role))
  if (missing.length === 0) return ready('sessions', 'a builder, reviewer and verifier session seen today')
  const fix: Fix = { kind: 'link', label: 'Connect a session', href: '/settings/api-key' }
  const detail = 'Runs of that role wait until one connects.'
  return gap('sessions', `No ${listOf([...missing])} session seen today`, detail, fix)
}

export const branchProtection = (f: ReadinessFacts): Finding => {
  const state = f.repository?.branchProtected ?? 'unknown'
  if (state === 'yes') return ready('branch-protection', 'branch protection on')
  if (state === 'no') {
    const detail = 'Shown for information: the factory does not change it.'
    return finding('branch-protection', 'note', 'Branch protection is off', detail)
  }
  const detail = 'The forge does not tell this plan. Nothing to do unless you know it is off.'
  return unknown('branch-protection', 'Branch protection unknown', detail)
}

const waited = (minutes: number): string => (minutes < 120 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`)

export const checksNotStarted = (f: ReadinessFacts): Finding => {
  const [first] = f.waiting
  if (first === undefined) return ready('checks-not-started', 'no ticket waits for checks that have not started')
  const count = f.waiting.length
  const who = count === 1 ? 'A ticket has' : `${count} tickets have`
  const detail = `${who} waited up to ${waited(first.waitedMinutes)} for checks that have not started.`
  const fix: Fix = { kind: 'link', label: 'Why', href: `/tickets/${first.recordId}` }
  return gap('checks-not-started', 'Checks have not started', detail, fix)
}

export const evaluate = (f: ReadinessFacts): Finding[] =>
  [
    requiredChecks(f),
    ciRuns(f),
    riskAreas(f),
    agentsFile(f),
    issueForms(f),
    sessions(f),
    branchProtection(f),
    checksNotStarted(f),
  ].filter((entry): entry is Finding => entry !== null)

export const describeChange = (change: Change): string =>
  change.setting === 'required-checks'
    ? listOf(change.names)
    : change.sets.map((set) => `${set.name}: ${listOf(set.paths)}`).join('\n')
