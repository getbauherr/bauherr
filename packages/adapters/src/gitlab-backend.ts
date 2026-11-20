import type { Backend, Capabilities, Forge, RepoRef, TicketSource } from './contracts.js';
import { linkLabel } from './contracts.js';
import { GitlabApi } from './gitlab-api.js';
import { GitlabReleases } from './gitlab-releases.js';
import { GitlabTickets } from './gitlab-tickets.js';
import type { GitlabOptions } from './gitlab.js';

class GitlabForge extends GitlabReleases implements Forge {
  linkLabel = (pr: { number: number }) => linkLabel('gitlab', pr.number);
}

export class GitlabBackend implements Backend {
  readonly capabilities: Capabilities = {
    attachments: false,
    nativeSubTickets: false,
    nativeBlocking: false,
    webhooks: false,
  };
  readonly forge: Forge;
  private http: GitlabApi;
  constructor(o: GitlabOptions) {
    this.http = new GitlabApi(o);
    this.forge = new GitlabForge(this.http, o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
  }
  tickets(repo: RepoRef): TicketSource {
    return new GitlabTickets(this.http, repo);
  }
}
