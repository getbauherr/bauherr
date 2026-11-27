export const MAX_WAIT_MS = 300_000;
const MAX_BACKOFF_MS = 30_000;
const NETWORK_CODE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR/;
const GIT_OUTAGE = /error: 5\d\d\b|HTTP 5\d\d\b|Could not resolve host|Connection (reset|timed out)/i;

/** The rate limit is used up until `resetAt`; a wait beyond MAX_WAIT_MS is not attempted. */
export class ForgeRateLimited extends Error {
  readonly status: number;
  readonly resetAt: Date;
  constructor(forge: string, status: number, method: string, path: string, waitMs: number, now = Date.now()) {
    super(`${forge} ${method} ${path} -> ${status}: rate limited for ${waitMs} ms`);
    this.status = status;
    this.resetAt = new Date(now + waitMs);
  }
}

/** Remaining calls of one token as the forge last reported them. */
export interface Budget {
  limit: number;
  remaining: number;
  resetAt: Date | null;
  observedAt: Date;
}

const budgets = new Map<string, Budget>();

export const budgetOf = (key: string): Budget | undefined => budgets.get(key);

const limitHeader = (res: Response, name: string): string | null =>
  res.headers.get(`x-ratelimit-${name}`) ?? res.headers.get(`ratelimit-${name}`);

const noteBudget = (key: string | undefined, res: Response): void => {
  const remaining = limitHeader(res, 'remaining');
  const limit = limitHeader(res, 'limit');
  if (key === undefined || remaining === null || limit === null) return;
  if ((res.headers.get('x-ratelimit-resource') ?? 'core') !== 'core') return;
  const reset = limitHeader(res, 'reset');
  budgets.set(key, {
    limit: Number(limit),
    remaining: Number(remaining),
    resetAt: reset === null ? null : new Date(Number(reset) * 1000),
    observedAt: new Date(),
  });
};

const isRateLimited = (res: Response): boolean =>
  res.status === 429 ||
  (res.status === 403 && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0'));

const retryAfterMs = (res: Response): number | null => {
  const seconds = Number(res.headers.get('retry-after'));
  return res.headers.has('retry-after') && Number.isFinite(seconds) ? seconds * 1000 : null;
};

const rateLimitWaitMs = (res: Response): number => {
  const reset = limitHeader(res, 'reset');
  const hinted = retryAfterMs(res);
  if (hinted !== null) return hinted;
  return reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 1000 : 60_000;
};

/** Exponential backoff with jitter: 250-500 ms, 500-1000 ms, 1-2 s, capped at 30 s. */
export const backoffMs = (attempt: number, random: () => number): number =>
  Math.round(Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.5 + random() / 2));

const statusOf = (error: Error): number | null => {
  const { status } = error as { status?: unknown };
  return typeof status === 'number' ? status : null;
};

/** A fetch that never got an answer: connection reset, DNS failure, timeout. */
export const isNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error) || statusOf(error) !== null) return false;
  const { code } = (error.cause ?? {}) as { code?: string };
  return (
    (error instanceof TypeError && error.message === 'fetch failed') ||
    NETWORK_CODE.test(code ?? '') ||
    /request timed out after/.test(error.message)
  );
};

/** True when the forge, not the request, is at fault: a 5xx answer, no answer, or a git transport failure. */
export const isForgeOutage = (error: unknown): boolean =>
  error instanceof Error &&
  ((statusOf(error) ?? 0) >= 500 ||
    isNetworkError(error) ||
    GIT_OUTAGE.test(error.message));

export interface RetryKit {
  sleep: (ms: number) => Promise<void>;
  maxRetries: number;
  random: () => number;
  budgetKey?: string | undefined;
}

export interface Attempt {
  forge: string;
  method: string;
  path: string;
  idempotent: boolean;
  send: () => Promise<Response>;
}

export interface WriteOptions {
  idempotent?: boolean;
}

export const IDEMPOTENT: WriteOptions = { idempotent: true };

export const IDEMPOTENT_METHODS = ['GET', 'HEAD'];

type Delay = { wait: number; limited: boolean } | null;

const delayBefore = (res: Response, idempotent: boolean, attempt: number, kit: RetryKit): Delay => {
  if (isRateLimited(res)) return { wait: rateLimitWaitMs(res), limited: true };
  if (res.status < 500 || !idempotent) return null;
  return { wait: retryAfterMs(res) ?? backoffMs(attempt, kit.random), limited: false };
};

const discard = (res: Response): void => void res.body?.cancel().catch(() => undefined);

const failed = async (kit: RetryKit, o: Attempt, attempt: number, error: unknown): Promise<void> => {
  if (!(attempt < kit.maxRetries && o.idempotent && isNetworkError(error))) throw error;
  await kit.sleep(backoffMs(attempt, kit.random));
};

const settled = async (kit: RetryKit, o: Attempt, res: Response, attempt: number): Promise<Response | null> => {
  noteBudget(kit.budgetKey, res);
  const delay = delayBefore(res, o.idempotent, attempt, kit);
  const tooLong = delay !== null && delay.wait > MAX_WAIT_MS;
  if (delay?.limited && tooLong) throw new ForgeRateLimited(o.forge, res.status, o.method, o.path, delay.wait);
  if (delay === null || tooLong || attempt >= kit.maxRetries) return res;
  discard(res);
  await kit.sleep(delay.wait);
  return null;
};

/**
 * Sends one request and retries it: rate limits (the call was refused, any method), and 5xx or network
 * errors (only when `idempotent`). Throws ForgeRateLimited when the wait exceeds MAX_WAIT_MS.
 */
export async function sendWithRetry(kit: RetryKit, o: Attempt): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await o.send().catch((error: unknown) => failed(kit, o, attempt, error));
    if (!res) continue;
    const done = await settled(kit, o, res, attempt);
    if (done) return done;
  }
}
