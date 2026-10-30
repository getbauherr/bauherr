/** Repository reference: `owner/name`. */
export type RepoRef = string;
export type TicketState = 'open' | 'closed';
export type CloseReason = 'completed' | 'not_planned' | 'duplicate';

export interface Capabilities {
  attachments: boolean;
  nativeSubTickets: boolean;
  nativeBlocking: boolean;
  webhooks: boolean;
}

export interface TicketSummary {
  id: string;
  number: number;
  url: string;
  title: string;
  state: TicketState;
  labels: string[];
  assignee: string | null;
  assignees: string[];
  updatedAt: string;
}

export interface Ticket extends TicketSummary {
  body: string;
  parent: string | null;
  blockedBy: string[];
  links: string[];
  closeReason?: CloseReason | null;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface ListOptions {
  state?: TicketState | 'all';
  labels?: string[];
}

export interface NewTicket {
  title: string;
  body?: string;
  labels?: string[];
}

export interface TicketSource {
  list(opts?: ListOptions): Promise<TicketSummary[]>;
  get(id: string): Promise<Ticket>;
  /** At-least-once: returns tickets with `updatedAt >= cursor`; `next` is the max `updatedAt` seen. Null cursor = all. */
  poll(cursor: string | null): Promise<{ changes: TicketSummary[]; next: string | null }>;
  create(t: NewTicket): Promise<Ticket>;
  comment(id: string, body: string): Promise<Comment>;
  listComments(id: string, since?: string): Promise<Comment[]>;
  updateComment(id: string, commentId: string, body: string): Promise<Comment>;
  addLabels(id: string, labels: string[]): Promise<void>;
  /** Absent labels are tolerated. */
  removeLabels(id: string, labels: string[]): Promise<void>;
  /** Throws if the assignee was not applied. */
  claim(id: string, assignee: string): Promise<void>;
  release(id: string): Promise<void>;
  /** Removes only these logins; other assignees stay. */
  unassign(id: string, assignees: string[]): Promise<void>;
  close(id: string, reason: CloseReason): Promise<void>;
  addSubTicket(parentId: string, childId: string): Promise<void>;
  listSubTickets(parentId: string): Promise<TicketSummary[]>;
  addBlockedBy(id: string, blockerId: string): Promise<void>;
  addLink(id: string, url: string): Promise<void>;
  /** Open sub-tickets of `parentId` whose blockers are all closed. */
  frontier(parentId: string): Promise<TicketSummary[]>;
  addAttachment?(id: string, name: string, data: Uint8Array): Promise<string>;
}

export interface Repository {
  fullName: RepoRef;
  defaultBranch: string;
  private: boolean;
  url: string;
}
export interface Branch {
  name: string;
  sha: string;
}
export interface PullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  head: string;
  base: string;
  headSha: string;
  /** `owner/name` of the repo the head branch lives in (differs from `baseRepo` for forks). */
  headRepo: string;
  baseRepo: string;
  draft: boolean;
  /** Set once merged. */
  mergeSha?: string;
}
export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}
export interface Check {
  /** Check run id; a higher id is a later run of the same name. */
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
}
export interface NewPullRequest {
  title: string;
  body?: string;
  head: string;
  base: string;
}

export interface Webhooks {
  register(repo: RepoRef, o: { url: string; secret: string; events: string[] }): Promise<{ id: string }>;
  /** Constant-time check of `X-Hub-Signature-256`-style signature over the raw body. */
  verify(rawBody: string | Uint8Array, signature: string | undefined, secret: string): boolean;
}

export interface Forge {
  listRepositories(): Promise<Repository[]>;
  getRepository(repo: RepoRef): Promise<Repository>;
  listBranches(repo: RepoRef): Promise<Branch[]>;
  /** Branches off `from` (default branch when omitted). */
  createBranch(repo: RepoRef, name: string, from?: string): Promise<Branch>;
  openPullRequest(repo: RepoRef, pr: NewPullRequest): Promise<PullRequest>;
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest>;
  listPullRequests(repo: RepoRef, state?: 'open' | 'closed' | 'all'): Promise<PullRequest[]>;
  commentOnPullRequest(repo: RepoRef, number: number, body: string): Promise<Comment>;
  listPullRequestFiles(repo: RepoRef, number: number): Promise<PullRequestFile[]>;
  /** Check runs plus legacy commit statuses (a status is a check named after its context). */
  listChecks(repo: RepoRef, sha: string): Promise<Check[]>;
  /** ISO time the commit was made. */
  getCommitDate(repo: RepoRef, sha: string): Promise<string>;
  /** Squash-merges an open PR (only while its head is still `expectSha`, when given) and optionally deletes its head branch (same-repo heads only; a failed delete is reported, not thrown); returns the merge commit sha. */
  mergePullRequest(repo: RepoRef, number: number, o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string }): Promise<{ mergeSha: string; branchDeleteError?: string }>;
  webhooks?: Webhooks;
}

export interface Backend {
  capabilities: Capabilities;
  forge: Forge;
  tickets(repo: RepoRef): TicketSource;
}
