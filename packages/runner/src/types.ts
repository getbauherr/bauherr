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
