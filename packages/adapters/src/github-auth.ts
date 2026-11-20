import { createSign } from 'node:crypto';
import { GithubError } from './github-error.js';
import { timedFetch } from './http.js';
import { text, wire } from './wire.js';

export interface GithubAuth {
  kind: 'pat' | 'app';
  token(): Promise<string>;
}

export const patAuth = (token: string): GithubAuth => ({ kind: 'pat', token: async () => token });

export interface AppAuthOptions {
  appId: string | number;
  installationId: string | number;
  privateKeyPem: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const b64url = (b: string | Buffer): string => Buffer.from(b).toString('base64url');

const appJwt = (o: AppAuthOptions, nowMs: number): string => {
  const iat = Math.floor(nowMs / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iat, exp: iat + 540, iss: String(o.appId) }));
  const data = `${header}.${claims}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(o.privateKeyPem).toString('base64url')}`;
};

/** GitHub App installation tokens: RS256 JWT -> installation token, cached until 5 min before expiry. */
export function appAuth(o: AppAuthOptions): GithubAuth {
  const doFetch = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  return {
    kind: 'app',
    async token() {
      if (cached && cached.expiresAt - 300_000 > now()) return cached.token;
      const res = await timedFetch(
        doFetch,
        `${o.baseUrl ?? 'https://api.github.com'}/app/installations/${o.installationId}/access_tokens`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${appJwt(o, now())}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'bauherr',
          },
        },
        o.timeoutMs,
      );
      if (!res.ok) throw new GithubError(res.status, 'POST', 'access_tokens', await res.text());
      const j = wire(await res.json());
      cached = { token: text(j.token), expiresAt: Date.parse(text(j.expires_at)) };
      return cached.token;
    },
  };
}
