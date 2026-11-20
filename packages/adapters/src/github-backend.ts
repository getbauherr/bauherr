import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Backend, Capabilities, Forge, RepoRef, TicketSource, Webhooks } from './contracts.js';
import { linkLabel } from './contracts.js';
import { GithubApi } from './github-api.js';
import type { GithubAuth } from './github-auth.js';
import type { GithubOptions, Http } from './github.js';
import { GithubReleases } from './github-releases.js';
import { GithubTickets } from './github-tickets.js';
import { idText, wire } from './wire.js';

export const githubWebhooks = (h: Http): Webhooks => ({
  async register(repo, o) {
    const hook: unknown = await h.json('POST', `/repos/${repo}/hooks`, {
      name: 'web',
      active: true,
      events: o.events,
      config: { url: o.url, content_type: 'json', secret: o.secret },
    });
    return { id: idText(wire(hook).id) };
  },
  verify(rawBody, signature, secret) {
    if (!signature) return false;
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
    const got = Buffer.from(signature);
    return got.length === expected.length && timingSafeEqual(got, expected);
  },
});

class GithubForge extends GithubReleases implements Forge {
  webhooks: Webhooks;
  constructor(h: GithubApi, auth: GithubAuth) {
    super(h, auth);
    this.webhooks = githubWebhooks(h);
  }
  linkLabel = (pr: { number: number }) => linkLabel('github', pr.number);
}

export class GithubBackend implements Backend {
  readonly capabilities: Capabilities = {
    attachments: false,
    nativeSubTickets: true,
    nativeBlocking: true,
    webhooks: true,
  };
  readonly forge: Forge;
  private http: GithubApi;
  constructor(o: GithubOptions) {
    this.http = new GithubApi(o);
    this.forge = new GithubForge(this.http, o.auth);
  }
  tickets(repo: RepoRef): TicketSource {
    return new GithubTickets(this.http, repo);
  }
}
