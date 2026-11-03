export const FORGE_TIMEOUT_MS = 30_000;

/** `fetch` that aborts after `timeoutMs` (unless the caller passed a signal) and throws a plain, retryable Error. */
export async function timedFetch(doFetch: typeof fetch, url: string, init: RequestInit, timeoutMs = FORGE_TIMEOUT_MS): Promise<Response> {
  try {
    return await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), ...init });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error(`${new URL(url).host} request timed out after ${timeoutMs / 1000}s`);
    throw e;
  }
}
