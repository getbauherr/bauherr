import { createHash } from 'node:crypto';
import type { GithubAuth } from './github-auth.js';
import { GithubError } from './github-error.js';
import { timedFetch } from './http.js';
import { IDEMPOTENT_METHODS, sendWithRetry, type RetryKit, type WriteOptions } from './retry.js';

export interface GithubOptions {
  auth: GithubAuth;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  random?: () => number;
  budgetKey?: string;
}

type Cached = { etag: string; body: string; headers: [string, string][] };

const CACHE_LIMIT = 2000;
const CACHE_BODY_LIMIT = 1_000_000;
const CACHE_BYTES_LIMIT = 32_000_000;
const KEPT_HEADERS = ['content-type', 'link'];
const conditional = new Map<string, Cached>();
let cachedBytes = 0;

const drop = (key: string): void => {
  const old = conditional.get(key);
  if (!old) return;
  cachedBytes -= old.body.length;
  conditional.delete(key);
};

const cacheKey = (token: string, accept: string, url: string): string =>
  `${createHash('sha256').update(token).digest('hex').slice(0, 16)} ${accept} ${url}`;

const remember = async (key: string, res: Response): Promise<void> => {
  const etag = res.headers.get('etag');
  if (!etag || !(res.headers.get('content-type') ?? '').includes('json')) return;
  const body = await res.clone().text();
  if (body.length > CACHE_BODY_LIMIT) return;
  drop(key);
  while (conditional.size >= CACHE_LIMIT || cachedBytes + body.length > CACHE_BYTES_LIMIT) {
    drop(conditional.keys().next().value!);
  }
  const headers = KEPT_HEADERS.flatMap((h): [string, string][] => {
    const v = res.headers.get(h);
    return v === null ? [] : [[h, v]];
  });
  conditional.set(key, { etag, body, headers });
  cachedBytes += body.length;
};

const lookup = (key: string | undefined): Cached | undefined => (key === undefined ? undefined : conditional.get(key));

const settle = async (
  res: Response,
  o: { method: string; path: string; key: string | undefined; cached: Cached | undefined },
): Promise<Response> => {
  if (res.status === 304 && o.cached) return new Response(o.cached.body, { status: 200, headers: o.cached.headers });
  if (!res.ok) throw new GithubError(res.status, o.method, o.path, await res.text());
  if (o.key !== undefined) await remember(o.key, res);
  return res;
};

/**
 * Minimal REST client: Link pagination, backoff on 403/429 honouring Retry-After, and conditional GETs
 * (If-None-Match) whose 304 answers GitHub does not count against the rate limit.
 */
export class Http {
  private base: string;
  private doFetch: typeof fetch;
  private kit: RetryKit;
  get authKind() {
    return this.o.auth.kind;
  }
  constructor(private o: GithubOptions) {
    this.base = o.baseUrl ?? 'https://api.github.com';
    this.doFetch = o.fetch ?? fetch;
    this.kit = {
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      maxRetries: o.maxRetries ?? 3,
      random: o.random ?? Math.random,
      budgetKey: o.budgetKey,
    };
  }

  async raw(
    method: string,
    path: string,
    body?: unknown,
    accept = 'application/vnd.github+json',
    opts: WriteOptions = {},
  ): Promise<Response> {
    const url = path.startsWith('http') ? path : this.base + path;
    const token = await this.o.auth.token();
    const key = method === 'GET' && body === undefined ? cacheKey(token, accept, url) : undefined;
    const cached = lookup(key);
    const res = await sendWithRetry(this.kit, {
      forge: 'GitHub',
      method,
      path,
      idempotent: opts.idempotent ?? IDEMPOTENT_METHODS.includes(method),
      send: () => this.send(method, url, { token, accept, body, etag: cached?.etag }),
    });
    return settle(res, { method, path, key, cached });
  }

  private send(method: string, url: string, o: { token: string; accept: string; body: unknown; etag?: string }) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${o.token}`,
      accept: o.accept,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'bauherr',
    };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.etag !== undefined) headers['if-none-match'] = o.etag;
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    return timedFetch(this.doFetch, url, { cache: 'no-store', method, headers, body }, this.o.timeoutMs);
  }

  async json<T = unknown>(method: string, path: string, body?: unknown, opts?: WriteOptions): Promise<T> {
    const res = await this.raw(method, path, body, undefined, opts);
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
