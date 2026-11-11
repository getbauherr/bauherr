import type { ProofItem, ReviewChecks } from './pre-review.js';

export type StepRecord = {
  runId: string;
  messageId: string;
  model: string;
  inputTokens: number;
  /** Placeholder per step (message_start value); exact totals are in RunResult.usage. */
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ToolCallRecord = {
  runId: string;
  toolUseId: string;
  tool: string;
  input: unknown;
  ok: boolean;
  /** Bash only: 0 on success, parsed from the failure text otherwise. */
  exitCode?: number;
  durationMs?: number;
};

export type RunCtx = {
  /** Stage names the Runner moves a Ticket to: the review stage after a Build Run pushed (absent when the workflow has none). */
  stageNames: { review?: string };
  run: {
    id: string;
    /** The Run's stage name in the workflow (display, gateway header); behaviour follows `kind`. */
    stage: string;
    kind: 'triage' | 'plan' | 'build' | 'review' | 'scan' | 'agent';
    goal: { statements: string[] };
    maxTurns: number;
    maxBudgetUsd: number;
    tier: 'cheap' | 'standard' | 'strong' | 'auto';
    /** Gateway model id of a role that pins provider and model; wins over `tier`. */
    model?: string;
  };
  /** Agent Run: the workflow stage, its skill, the role profile and the outcome keys the agent may report. */
  agent?: { stage: string; title: string; skill: string; roleProfile: string; outcomes: string[] };
  ticket: { id?: string; number: number; url: string; title: string; body: string; worklog?: string; plan?: string; investigation?: string };
  product: { id?: string; repo: string; defaultBranch: string; reviewChecks?: ReviewChecks | null; /** Scan Run: the Product's SECURITY-CONTEXT.md from the Knowledge repo; absent when missing. */ securityContext?: string };
  /** Review Run after a conflict return: the SHA the previous review covered; review only the diff from it to the new head (the merge resolution). */
  conflictBase?: string;
  /** Review Run: the review round (1 = first), and from round 2 the head the previous review covered; review only the diff from it to the new head (the fix). */
  reviewRound?: number;
  fixBase?: string;
  /** Build Run on an existing MR: the Runner merges the base branch in before the agent (and skips the agent when the merge is clean). */
  mergeBase?: boolean;
  /** The Ticket's open factory MR: a Build Run pushes to its branch (no new MR); a Review Run reads it. */
  existingPr?: { number: number; url: string; branch: string; title: string; body: string };
  connection: {
    gatewayUrl: string;
    gatewayKey: string;
    gitToken: string;
    modelByTier: Record<string, string>;
    /** Forge base URL the repo path is appended to. Default `https://github.com`. */
    gitBaseUrl?: string;
    /** Basic-auth username for the clone token. Default `x-access-token` (GitHub); GitLab uses `oauth2`. */
    gitUser?: string;
  };
  forge: {
    openPullRequest(p: { repo: string; head: string; base: string; title: string; body: string }): Promise<{ url: string }>;
    comment(ticketNumber: number, body: string): Promise<void>;
    /** Creates or updates the Ticket's `<!-- bauherr:worklog -->` Comment. */
    upsertWorklog(ticketNumber: number, body: string): Promise<void>;
    /** Replaces the Ticket's `bauherr:stage:*` Label. */
    setStage(ticketNumber: number, stage: string): Promise<void>;
  };
  recorder: {
    step(d: StepRecord): Promise<void>;
    toolCall(d: ToolCallRecord): Promise<void>;
    log(msg: string): void;
  };
  /** The Workspace's effective templates by skill name (`SKILL_TEMPLATES`): each is appended to that skill's text under `## Template: <title>`. */
  templates?: Record<string, { title: string; body: string }[]>;
  /** Path to the core pack (`pack/`). */
  packDir: string;
};

export type RunResult = {
  status: 'succeeded' | 'failed' | 'needs_human' | 'budget_exhausted';
  reason?: string;
  /** Why a `needs_human` Run stopped: decision and access reach the owner, stuck escalates to a stronger model. */
  reasonKind?: ReasonKind;
  artifacts: { prUrl?: string; commentUrl?: string; evidence?: string; review?: unknown; triage?: unknown; scan?: unknown; agentOutcome?: unknown; investigation?: unknown; reviewedSha?: string; patchId?: string; pushedSha?: string; uptodate?: boolean; reviewedPatchId?: string; mergeConflict?: boolean; /** Build Run: the proof the Product's artifact rules asked for, with file bytes; the server stores it and drops the field from the Run. */ proof?: ProofItem[] };
  usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; costEstimateUsd: number };
};

export type ReasonKind = 'decision' | 'access' | 'stuck';
export type GoalStatement = { text: string; status: 'unverified' | 'verified' | 'blocked'; reason?: string; kind?: ReasonKind };
