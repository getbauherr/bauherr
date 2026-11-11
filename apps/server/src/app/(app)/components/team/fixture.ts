import type { ModelOption, TeamRole, TeamSession } from './types'

/** Pinned: the screenshots and tests do not drift with the clock. */
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 6e4).toISOString()
const session = (publicId: string, label: string, status: TeamSession['status'], extra: Partial<TeamSession> = {}): TeamSession => ({
  publicId,
  label,
  clientName: 'Claude Code',
  clientVersion: '2.1.0',
  model: 'claude-sonnet-4-6',
  provider: 'Anthropic',
  status,
  connectedAt: at(95),
  lastSeenAt: at(status === 'offline' ? 3 : 0),
  activeSecondsToday: 4320,
  activeSecondsTotal: 86400,
  ...extra,
})

const stage = {
  triage: { name: 'triage', title: 'Triage', kind: 'triage' },
  plan: { name: 'plan', title: 'Plan', kind: 'plan' },
  build: { name: 'build', title: 'Build', kind: 'build' },
  review: { name: 'review', title: 'Review', kind: 'review' },
}

export const modelOptions: ModelOption[] = [
  { value: 'tier:cheap', label: 'Cheap tier (claude-haiku-5-5)', group: 'Tier' },
  { value: 'tier:standard', label: 'Standard tier (claude-sonnet-5-5)', group: 'Tier' },
  { value: 'tier:strong', label: 'Strong tier (claude-opus-5-5)', group: 'Tier' },
  { value: 'anthropic/claude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' },
  { value: 'anthropic/claude-opus-5-5', label: 'claude-opus-5-5', group: 'Anthropic' },
]

export const roles: TeamRole[] = [
  {
    id: 'orchestrator', skills: ['Triage', 'Routing', 'Unblocking'], title: 'Orchestrator', avatar: 'orchestrator', tier: 'strong', agents: 1, exceptions: true,
    profile: 'Plans the work and routes every ticket to the right specialist.\n\nIt splits requests into tickets, orders them by dependency and **picks up** anything that gets stuck.',
    stages: [stage.triage, stage.plan],
    sessions: [session('s-orch', 'orchestrator@laptop', 'idle', { model: 'claude-opus-5-5', ticket: undefined })], autonomous: [],
  },
  {
    id: 'engineer', skills: ['TypeScript', 'Small diffs', 'Tests first', 'Refactoring'], title: 'Software Engineer', avatar: 'engineer', provider: 'anthropic', model: 'claude-sonnet-5-5', agents: 3, exceptions: false,
    profile: 'Builds the change and opens the merge request.\n\nWorks one ticket at a time, runs the checks before it asks for review and keeps the diff small.',
    stages: [stage.build],
    sessions: [
      session('s-eng-1', 'engineer-1@laptop', 'working', { ticket: { number: 412, title: 'Team page character select', stage: stage.build.name }, run: 9 }),
      session('s-eng-2', 'engineer-2@devbox', 'idle', { connectedAt: at(200), activeSecondsToday: 900 }),
      session('s-eng-3', 'engineer-3@devbox', 'offline', { activeSecondsToday: 0, activeSecondsTotal: 3600 }),
    ],
    autonomous: [{ run: 14, ticket: { number: 415, title: 'Fix flaky export test', stage: stage.build.name }, executor: 'runner', startedAt: at(18), model: 'claude-sonnet-4-6' }],
  },
  {
    id: 'reviewer', skills: ['Diff reading', 'Plan conformance', 'Repo rules'], title: 'Code Reviewer', avatar: 'reviewer', tier: 'strong', agents: 1, exceptions: false,
    profile: 'Reads the diff against the plan and the repository rules.\n\nRequests changes with a reason per finding.',
    stages: [stage.review], sessions: [], autonomous: [],
  },
  {
    id: 'security', skills: ['Threat modelling', 'AuthZ', 'Secrets'], title: 'Security Specialist', avatar: 'security', tier: 'strong', agents: 1, exceptions: false,
    profile: 'Checks every change for secrets, injection and unsafe defaults.\n\nBlocks the merge when a finding is not accepted by the owner.',
    stages: [stage.review], sessions: [], autonomous: [{ run: 15, ticket: { number: 418, title: 'Dependency audit', stage: stage.build.name }, executor: 'ci', startedAt: at(4), model: 'claude-sonnet-4-6' }],
  },
  {
    id: 'ux', skills: ['Flows', 'States', 'Copy', 'Accessibility'], title: 'UX Specialist', avatar: 'ux', tier: 'standard', agents: 1, exceptions: false,
    profile: 'Keeps screens consistent with the design system.\n\nChecks layout, copy and keyboard use.',
    stages: [stage.review], sessions: [], autonomous: [],
  },
  {
    id: 'test', skills: ['Failure modes', 'Regression'], title: 'Test Specialist', avatar: 'test', tier: 'cheap', exceptions: false,
    profile: 'Writes the tests that prove the change and hunts for the case that breaks it.',
    stages: [stage.build], sessions: [], autonomous: [],
  },
]
