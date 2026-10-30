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
  ticket: { id?: string; number: number; url: string; title: string; body: string; worklog?: string; plan?: string };
  product: { id?: string; repo: string; defaultBranch: string };
  /** The Ticket's open factory MR: a Build Run pushes to its branch (no new MR); a Review Run reads it. */
  existingPr?: { number: number; url: string; branch: string; title: string; body: string };
  connection: {
    gatewayUrl: string;
    gatewayKey: string;
    gitToken: string;
    modelByTier: Record<string, string>;
    /** Forge base URL the repo path is appended to. Default `https://github.com`. */
    gitBaseUrl?: string;
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
  artifacts: { prUrl?: string; commentUrl?: string; evidence?: string; review?: unknown; triage?: unknown; reviewedSha?: string };
  usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; costEstimateUsd: number };
};

export type GoalStatement = { text: string; status: 'unverified' | 'verified' | 'blocked'; reason?: string };
