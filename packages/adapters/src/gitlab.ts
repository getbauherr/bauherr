import { MAX_WAIT_MS } from './github.js';
import { timedFetch } from './http.js';
import { num, wire } from './wire.js';

export interface GitlabAuth {
  token(): Promise<string>;
}

/** Personal / group service-account access token (scope `api`), sent as `PRIVATE-TOKEN`. */
export const gitlabPat = (token: string): GitlabAuth => ({ token: async () => token });

const enc = encodeURIComponent;
const REPORTER = 20;

export class GitlabError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
    detail: string,
  ) {
    super(`GitLab ${method} ${path} -> ${status}: ${detail.slice(0, 300)}`);
  }
}

export interface GitlabOptions {
  auth: GitlabAuth;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

/** Minimal REST client: `Link rel="next"` pagination, backoff on 429 honouring Retry-After. */
export class GitlabHttp {
  private base: string;
  private doFetch: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;
  constructor(private o: GitlabOptions) {
    this.base = `${(o.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')}/api/v4`;
    this.doFetch = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = o.maxRetries ?? 3;
  }

  async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const url = path.startsWith('http') ? path : this.base + path;
    for (let attempt = 0; ; attempt++) {
      const res = await timedFetch(
        this.doFetch,
        url,
        {
          cache: 'no-store',
          method,
          headers: {
            'private-token': await this.o.auth.token(),
            accept: 'application/json',
            'user-agent': 'bauherr',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        this.o.timeoutMs,
      );
      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Number(res.headers.get('retry-after') ?? 60) * 1000;
        if (wait > MAX_WAIT_MS) throw new GitlabError(429, method, path, `rate limited for ${wait} ms`);
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) throw new GitlabError(res.status, method, path, await res.text());
      return res;
    }
  }

  async json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.raw(method, path, body);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private members = new Map<string, Promise<boolean>>();

  trusted(project: string, userId: number | undefined): Promise<boolean> {
    if (userId === undefined) return Promise.resolve(false);
    const key = `${project}/${userId}`;
    let known = this.members.get(key);
    if (!known) {
      known = this.json<unknown>('GET', `/projects/${enc(project)}/members/all/${userId}`).then(
        (member) => num(wire(member).access_level) >= REPORTER,
        (e: unknown) => {
          if (e instanceof GitlabError && e.status === 404) return false;
          this.members.delete(key);
          throw e;
        },
      );
      this.members.set(key, known);
    }
    return known;
  }

  async paginate<T = unknown>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const res: Response = await this.raw('GET', next);
      out.push(...((await res.json()) as T[]));
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1];
      if (next && new URL(next, this.base).origin !== new URL(this.base).origin) {
        throw new GitlabError(
          0,
          'GET',
          path,
          `refusing to follow a Link to another origin: ${new URL(next, this.base).origin}`,
        );
      }
    }
    return out;
  }
}
