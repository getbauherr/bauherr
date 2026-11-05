import type { ReviewChecks } from './pre-review.js';

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
  run: {
    id: string;
    stage: 'triage' | 'plan' | 'build' | 'review';
    goal: { statements: string[] };
    maxTurns: number;
    maxBudgetUsd: number;
    tier: 'cheap' | 'standard' | 'strong';
  };
  ticket: { id?: string; number: number; url: string; title: string; body: string; worklog?: string; plan?: string; investigation?: string };
  product: { id?: string; repo: string; defaultBranch: string; reviewChecks?: ReviewChecks | null };
  /** Review Run after a conflict return: the SHA the previous review covered; review only the diff from it to the new head (the merge resolution). */
  conflictBase?: string;
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
  /** Path to the core pack (`pack/`). */
  packDir: string;
};

export type RunResult = {
  status: 'succeeded' | 'failed' | 'needs_human' | 'budget_exhausted';
  reason?: string;
  artifacts: { prUrl?: string; commentUrl?: string; evidence?: string; review?: unknown; triage?: unknown; investigation?: unknown; reviewedSha?: string; patchId?: string; pushedSha?: string; uptodate?: boolean; reviewedPatchId?: string; mergeConflict?: boolean };
  usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; costEstimateUsd: number };
};

export type GoalStatement = { text: string; status: 'unverified' | 'verified' | 'blocked'; reason?: string };
