import type { ModelOption, TeamRole, TeamSession } from './types'

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
  { value: 'tier:small', label: 'Small tier', group: 'Tier' },
  { value: 'tier:large', label: 'Large tier', group: 'Tier' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', group: 'Anthropic' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', group: 'Anthropic' },
  { value: 'gpt-5.1', label: 'GPT-5.1', group: 'OpenAI' },
]

export const roles: TeamRole[] = [
  {
    id: 'orchestrator', title: 'Orchestrator', avatar: 'orchestrator', tier: 'large', model: 'claude-opus-4-8', agents: 1, exceptions: true,
    profile: 'Plans the work and routes every ticket to the right specialist.\n\nIt splits requests into tickets, orders them by dependency and **picks up** anything that gets stuck.',
    stages: [stage.triage, stage.plan],
    sessions: [session('s-orch', 'orchestrator@laptop', 'idle', { model: 'claude-opus-4-8', ticket: undefined })], autonomous: [],
  },
  {
    id: 'engineer', title: 'Software Engineer', avatar: 'engineer', tier: 'medium', model: 'claude-sonnet-4-6', agents: 3,
    profile: 'Builds the change and opens the merge request.\n\nWorks one ticket at a time, runs the checks before it asks for review and keeps the diff small.',
    stages: [stage.build],
    sessions: [
      session('s-eng-1', 'engineer-1@laptop', 'working', { ticket: { number: 412, title: 'Team page character select', stage: 'Build' }, runId: 9 }),
      session('s-eng-2', 'engineer-2@devbox', 'idle', { connectedAt: at(200), activeSecondsToday: 900 }),
      session('s-eng-3', 'engineer-3@devbox', 'offline', { activeSecondsToday: 0, activeSecondsTotal: 3600 }),
    ],
    autonomous: [{ runId: 14, ticket: { number: 415, title: 'Fix flaky export test' }, executor: 'runner', since: at(18) }],
  },
  {
    id: 'reviewer', title: 'Code Reviewer', avatar: 'reviewer', tier: 'large', model: 'claude-opus-4-8', agents: 1,
    profile: 'Reads the diff against the plan and the repository rules.\n\nRequests changes with a reason per finding.',
    stages: [stage.review], sessions: [], autonomous: [],
  },
  {
    id: 'security', title: 'Security Specialist', avatar: 'security', tier: 'large', provider: 'Anthropic', agents: 1,
    profile: 'Checks every change for secrets, injection and unsafe defaults.\n\nBlocks the merge when a finding is not accepted by the owner.',
    stages: [stage.review], sessions: [], autonomous: [{ runId: 15, ticket: { number: 418, title: 'Dependency audit' }, executor: 'ci', since: at(4) }],
  },
  {
    id: 'ux', title: 'UX Specialist', avatar: 'ux', model: 'claude-sonnet-4-6', agents: 1,
    profile: 'Keeps screens consistent with the design system.\n\nChecks layout, copy and keyboard use.',
    stages: [stage.review], sessions: [], autonomous: [],
  },
  {
    id: 'test', title: 'Test Specialist', avatar: 'test', tier: 'small', model: 'claude-sonnet-4-6',
    profile: 'Writes the tests that prove the change and hunts for the case that breaks it.',
    stages: [stage.build], sessions: [], autonomous: [],
  },
]
