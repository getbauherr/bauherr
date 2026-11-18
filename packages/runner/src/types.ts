import type { ProofItem, ReviewChecks } from './pre-review.js';

export type StepRecord = {
  runId: string;
  messageId: string;
  model: string;
  inputTokens: number;
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
  exitCode?: number;
  durationMs?: number;
};

export type RunCtx = {
  stageNames: { review?: string };
  run: {
    id: string;
    stage: string;
    kind: 'triage' | 'plan' | 'build' | 'review' | 'scan' | 'docs' | 'agent';
    goal: { statements: string[] };
    maxTurns: number;
    maxBudgetUsd: number;
    tier: 'cheap' | 'standard' | 'strong' | 'auto';
    model?: string;
  };
  agent?: { stage: string; title: string; skill: string; roleProfile: string; outcomes: string[]; /** A Job of a review stage: also reports `findings` and `open` in the outcome file. */ findings?: boolean };
  staging?: { url: string | null; sha: string | null };
  candidates?: { job: string; findings: unknown[]; open: unknown[] }[];
  ticket: { id?: string; number: number; url: string; title: string; body: string; worklog?: string; plan?: string; investigation?: string };
  product: { id?: string; repo: string; defaultBranch: string; reviewChecks?: ReviewChecks | null; /** Scan Run: the Product's SECURITY-CONTEXT.md from the Knowledge repo; absent when missing. */ securityContext?: string; /** Review Run: `REVIEW.md` of the base branch (untrusted, capped at 20 KB). */ reviewMd?: string; /** Docs Run: the Product's docs path globs and the Tickets merged since the last check. */ docs?: { paths: string[]; merged: { number: number; title: string; mergeSha: string }[] } };
  conflictBase?: string;
  reviewRound?: number;
  fixBase?: string;
  mergeBase?: boolean;
  branch?: string;
  prTitle?: string;
  slice?: { prev: string | null; mergeMain: boolean };
  epic?: { parent: number; parentUrl: string; worklog: string; slices: { number: number; title: string; prev: string | null; head: string | null; fixes: { sha: string; finding: string }[] }[] };
  existingPr?: { number: number; url: string; branch: string; title: string; body: string };
  connection: {
    gatewayUrl: string;
    gatewayKey: string;
    gitToken: string;
    modelByTier: Record<string, string>;
    gitBaseUrl?: string;
    gitUser?: string;
  };
  forge: {
    openPullRequest(p: { repo: string; head: string; base: string; title: string; body: string }): Promise<{ url: string }>;
    comment(ticketNumber: number, body: string): Promise<void>;
    upsertWorklog(ticketNumber: number, body: string): Promise<void>;
    setStage(ticketNumber: number, stage: string): Promise<void>;
  };
  recorder: {
    step(d: StepRecord): Promise<void>;
    toolCall(d: ToolCallRecord): Promise<void>;
    log(msg: string): void;
  };
  templates?: Record<string, { title: string; body: string }[]>;
  packDir: string;
  shouldStop?: () => Promise<boolean>;
};

export type RunResult = {
  status: 'succeeded' | 'failed' | 'needs_human' | 'budget_exhausted' | 'preempted';
  reason?: string;
  reasonKind?: ReasonKind;
  artifacts: { prUrl?: string; commentUrl?: string; evidence?: string; review?: unknown; triage?: unknown; scan?: unknown; docs?: unknown; agentOutcome?: unknown; investigation?: unknown; reviewedSha?: string; patchId?: string; pushedSha?: string; uptodate?: boolean; reviewedPatchId?: string; mergeConflict?: boolean; /** Build Run: the proof the Product's artifact rules asked for, with file bytes; the server stores it and drops the field from the Run. */ proof?: ProofItem[] };
  usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; costEstimateUsd: number };
};

export type ReasonKind = 'decision' | 'access' | 'stuck';
export type GoalStatement = { text: string; status: 'unverified' | 'verified' | 'blocked'; reason?: string; kind?: ReasonKind };
