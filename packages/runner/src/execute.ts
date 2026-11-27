import { buildOptions, runAgent, type AgentOptions, type AgentState } from './agent.js';
import { killRunProcesses } from './identity.js';
import { startProxy } from './proxy.js';

export type ExecuteOptions = Omit<AgentOptions, 'proxyUrl' | 'instructions'> & {
  stage: string;
  prompt: string;
  instructions?: string;
  gatewayUrl: string;
  gatewayKey: string;
  timeoutMs: number;
  product?: string;
  ticket?: string;
};

export type Executed = { ok: true; costUsd: number } | { ok: false; reason: string };

const failure = (state: AgentState, timedOut: boolean, timeoutMs: number, crash: string | null): string | null => {
  if (timedOut) return `the agent timed out after ${Math.round(timeoutMs / 60_000)} minutes`;
  if (state.budgetExhausted) return 'the Workspace budget is exhausted';
  if (state.stuck) return state.stuck;
  if (!state.result) {
    return crash
      ? `the agent ended without a result message: ${crash}`.slice(0, 300)
      : 'the agent ended without a result message';
  }
  if (state.result.subtype !== 'success') return `the agent stopped: ${state.result.subtype}`;
  return state.result.is_error ? `the agent reported an error: ${state.result.result}`.slice(0, 300) : null;
};

export async function execute(o: ExecuteOptions): Promise<Executed> {
  const state: AgentState = { toolCalls: [], steps: [], results: [], abort: new AbortController() };
  const proxy = await startProxy({
    gatewayUrl: o.gatewayUrl,
    gatewayKey: o.gatewayKey,
    runId: o.runId,
    stage: o.stage,
    ...(o.product && { product: o.product }),
    ...(o.ticket && { ticket: o.ticket }),
    onBudgetExceeded: () => {
      state.budgetExhausted = true;
      state.abort.abort();
    },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    state.abort.abort();
  }, o.timeoutMs);
  let crash: string | null = null;
  try {
    const options = buildOptions({ ...o, proxyUrl: proxy.url, instructions: o.instructions ?? '' }, state);
    await runAgent(o.runId, options, o.prompt, state);
  } catch (e) {
    crash = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
    await proxy.close();
    await killRunProcesses(o.cwd);
  }
  const reason = failure(state, timedOut, o.timeoutMs, crash) ?? crash;
  if (reason !== null || !state.result) return { ok: false, reason: reason ?? 'the agent did not run' };
  return { ok: true, costUsd: state.result.total_cost_usd };
}
