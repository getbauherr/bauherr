import type { GithubAuth } from './github-auth.js';
import { GithubError } from './github-error.js';
import { timedFetch } from './http.js';

export interface GithubOptions {
  auth: GithubAuth;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

export const MAX_WAIT_MS = 300_000;

const isRateLimited = (res: Response): boolean =>
  res.status === 429 ||
  (res.status === 403 && (res.headers.has('retry-after') || res.headers.get('x-ratelimit-remaining') === '0'));

const rateLimitWaitMs = (res: Response): number => {
  const retryAfter = res.headers.get('retry-after');
  const reset = res.headers.get('x-ratelimit-reset');
  if (retryAfter) return Number(retryAfter) * 1000;
  return reset ? Math.max(0, Number(reset) * 1000 - Date.now()) + 1000 : 60_000;
};

/** Minimal REST client: Link pagination, backoff on 403/429 honouring Retry-After. */
export class Http {
  private base: string;
  private doFetch: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;
  get authKind() {
    return this.o.auth.kind;
  }
  constructor(private o: GithubOptions) {
    this.base = o.baseUrl ?? 'https://api.github.com';
    this.doFetch = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 3;
  }

  async raw(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Response> {
    const url = path.startsWith('http') ? path : this.base + path;
    for (let attempt = 0; ; attempt++) {
      const res = await timedFetch(
        this.doFetch,
        url,
        {
          cache: 'no-store',
          method,
          headers: {
            authorization: `Bearer ${await this.o.auth.token()}`,
            accept,
            'x-github-api-version': '2022-11-28',
            'user-agent': 'bauherr',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        this.o.timeoutMs,
      );
      if (isRateLimited(res) && attempt < this.maxRetries) {
        const wait = rateLimitWaitMs(res);
        if (wait > MAX_WAIT_MS) throw new GithubError(res.status, method, path, `rate limited for ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) throw new GithubError(res.status, method, path, await res.text());
      return res;
    }
  }

  async json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async paginate<T = unknown>(path: string, pick?: (page: unknown) => T[]): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const res: Response = await this.raw('GET', next);
      const page: unknown = await res.json();
      out.push(...(pick ? pick(page) : (page as T[])));
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
    }
    return out;
  }
}
