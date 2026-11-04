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

/** A label change on a ticket, oldest first from `labelEvents`. */
export interface LabelEvent {
  label: string;
  action: 'labeled' | 'unlabeled';
  /** Login of whoever changed the label; null when the forge does not say. */
  actor: string | null;
  at: string;
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
  /** Label changes of the ticket, oldest first. */
  labelEvents(id: string): Promise<LabelEvent[]>;
  /** Login of the forge credential; null when the credential has no user (an App token). Throws when the login cannot be determined. */
  whoami(): Promise<string | null>;
  /** Throws if the assignee was not applied. */
  claim(id: string, assignee: string): Promise<void>;
  release(id: string): Promise<void>;
  /** Whether the forge knows this user login. */
  userExists(login: string): Promise<boolean>;
  /** Removes only these logins; other assignees stay. */
  unassign(id: string, assignees: string[]): Promise<void>;
  close(id: string, reason: CloseReason): Promise<void>;
  /** Idempotent. */
  reopen(id: string): Promise<void>;
  addSubTicket(parentId: string, childId: string): Promise<void>;
  listSubTickets(parentId: string): Promise<TicketSummary[]>;
  addBlockedBy(id: string, blockerId: string): Promise<void>;
  addLink(id: string, url: string): Promise<void>;
  /** Open sub-tickets of `parentId` whose blockers are all closed. */
  frontier(parentId: string): Promise<TicketSummary[]>;
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
  /** False only when the forge reports conflicts with the base (GitLab: `has_conflicts` / `merge_status: cannot_be_merged`); undefined while unknown. */
  mergeable?: boolean;
  /** True when the forge reports the head as behind the base (GitHub `mergeable_state: behind`, GitLab `need_rebase`); the factory then merges the base in. */
  behind?: boolean;
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
  /** When the run started (check runs) or the status was created; ISO 8601. */
  startedAt?: string;
  /** Link to the run or status, when the forge has one. */
  url?: string;
  /** Workflow run (GitHub Actions) or pipeline (GitLab) the check belongs to; `rerunFailed` re-runs it. */
  runId?: number;
}
export interface NewPullRequest {
  title: string;
  body?: string;
  head: string;
  base: string;
}

export interface Release {
  /** True for a pre-release (GitHub flag); `latestRelease` never returns one. */
  prerelease?: boolean;
  /** Forge id (GitHub numeric id, GitLab tag name), to be passed back to `updateRelease`. */
  id: string;
  tag: string;
  /** Commit the tag points at. */
  sha: string;
  name: string;
  body: string;
  url: string;
  /** ISO time the release was created on the forge. */
  createdAt?: string;
}

/** Thrown by `putFile` when `expectSha` no longer matches the file. */
export class Conflict extends Error {}

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
  /** Closes an open PR without merging; idempotent. */
  closePullRequest(repo: RepoRef, number: number): Promise<void>;
  commentOnPullRequest(repo: RepoRef, number: number, body: string): Promise<Comment>;
  listPullRequestComments(repo: RepoRef, number: number): Promise<Comment[]>;
  listPullRequestFiles(repo: RepoRef, number: number): Promise<PullRequestFile[]>;
  /** Check runs plus legacy commit statuses (a status is a check named after its context). */
  listChecks(repo: RepoRef, sha: string): Promise<Check[]>;
  /** Re-runs the failed jobs of the runs these checks belong to; false when nothing could be re-run (commit status, bridge, no `runId`). */
  rerunFailed(repo: RepoRef, checks: Check[]): Promise<boolean>;
  /** ISO time the commit was made. */
  getCommitDate(repo: RepoRef, sha: string): Promise<string>;
  /** Squash-merges an open PR (only while its head is still `expectSha`, when given) and optionally deletes its head branch (same-repo heads only; a failed delete is reported, not thrown); returns the merge commit sha. */
  mergePullRequest(repo: RepoRef, number: number, o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string }): Promise<{ mergeSha: string; branchDeleteError?: string }>;
  /** Blob paths of `ref` (default branch when omitted) and the commit sha they belong to. */
  listFiles(repo: RepoRef, ref?: string): Promise<{ commit: string; paths: string[]; truncated?: boolean }>;
  /** `sha` is the blob sha, to be passed back as `putFile`'s `expectSha`. */
  getFile(repo: RepoRef, path: string, ref?: string): Promise<{ content: string; sha: string }>;
  /** Commits `content` to `branch`; with `expectSha` the file must still have that blob sha (`''` = must not exist), else throws `Conflict`. */
  putFile(repo: RepoRef, o: { branch: string; path: string; content: string; message: string; expectSha?: string }): Promise<{ sha: string }>;
  /** The first published (non-draft) release whose tag commit is `sha` or a descendant of it (the release that shipped it), or null. */
  findRelease(repo: RepoRef, o: { sha: string }): Promise<Release | null>;
  /** Creates the tag on `sha` and publishes the release. */
  createRelease(repo: RepoRef, o: { tag: string; sha: string; name: string; body: string; prerelease?: boolean }): Promise<Release>;
  /** Names of all tags, with or without a release. */
  listTags(repo: RepoRef): Promise<string[]>;
  updateRelease(repo: RepoRef, id: string, o: { body: string }): Promise<Release>;
  /** The newest published stable release (never a pre-release), or null. */
  latestRelease(repo: RepoRef): Promise<Release | null>;
  /** Commits after `from` up to `to` (newest first; the last 100 of `to` without `from`). */
  listCommits(repo: RepoRef, o: { from?: string; to: string }): Promise<{ sha: string; message: string }[]>;
  webhooks?: Webhooks;
}

/** The forge accepted the merge but has not finished it; retry later without counting a failure. */
export class MergePendingError extends Error {}

export interface Backend {
  capabilities: Capabilities;
  forge: Forge;
  tickets(repo: RepoRef): TicketSource;
}
