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
  createdAt: string;
  closedAt?: string;
  author: string;
  authorTrusted: boolean;
  authorIsBot: boolean;
  body?: string;
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
  updatedAt: string;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export interface ReviewThread {
  id: string;
  body: string;
  resolved: boolean;
}

export interface ListOptions {
  state?: TicketState | 'all';
  labels?: string[];
}

export interface NewTicket {
  title: string;
  body?: string;
  labels?: string[];
  author?: string;
}

/** A label change on a ticket, oldest first from `labelEvents`. */
export interface LabelEvent {
  label: string;
  action: 'labeled' | 'unlabeled';
  actor: string | null;
  at: string;
}

export interface TicketSource {
  list(opts?: ListOptions): Promise<TicketSummary[]>;
  get(id: string): Promise<Ticket>;
  poll(cursor: string | null): Promise<{ changes: TicketSummary[]; next: string | null }>;
  create(t: NewTicket): Promise<Ticket>;
  update(id: string, patch: { title?: string; body?: string }): Promise<void>;
  comment(id: string, body: string): Promise<Comment>;
  listComments(id: string, since?: string): Promise<Comment[]>;
  updateComment(id: string, commentId: string, body: string): Promise<Comment>;
  addLabels(id: string, labels: string[]): Promise<void>;
  removeLabels(id: string, labels: string[]): Promise<void>;
  labelEvents(id: string): Promise<LabelEvent[]>;
  whoami(): Promise<string | null>;
  claim(id: string, assignee: string): Promise<void>;
  release(id: string): Promise<void>;
  userExists(login: string): Promise<boolean>;
  unassign(id: string, assignees: string[]): Promise<void>;
  close(id: string, reason: CloseReason): Promise<void>;
  reopen(id: string): Promise<void>;
  addSubTicket(parentId: string, childId: string): Promise<void>;
  listSubTickets(parentId: string): Promise<TicketSummary[]>;
  addBlockedBy(id: string, blockerId: string): Promise<void>;
  addLink(id: string, url: string): Promise<void>;
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
  headRepo: string;
  baseRepo: string;
  draft: boolean;
  author: string;
  authorTrusted: boolean;
  authorIsBot: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  labels: string[];
  assignees: string[];
  closes: number[];
  mergeable?: boolean;
  behind?: boolean;
  mergeSha?: string;
}
export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}
export interface Check {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt?: string;
  url?: string;
  runId?: number;
  output?: string;
}
export interface NewPullRequest {
  title: string;
  body?: string;
  head: string;
  base: string;
}

export interface Release {
  prerelease?: boolean;
  id: string;
  tag: string;
  sha: string;
  name: string;
  body: string;
  url: string;
  createdAt?: string;
}

/** Thrown by `putFile` when `expectSha` no longer matches the file. */
export class Conflict extends Error {}

export interface Webhooks {
  register(repo: RepoRef, o: { url: string; secret: string; events: string[] }): Promise<{ id: string }>;
  verify(rawBody: string | Uint8Array, signature: string | undefined, secret: string): boolean;
}

/** Label of the link button to a PR of the forge `kind` ("github" or "gitlab"), in plain words; "Open merge request" for an unknown kind. Pure: needs no Connection secret. */
export const linkLabel = (kind: string | null | undefined, number: number): string =>
  kind === 'github' ? `Open pull request #${number} on GitHub` : kind === 'gitlab' ? `Open merge request !${number} on GitLab` : 'Open merge request';

export interface Forge {
  linkLabel(pr: { number: number }): string;
  listRepositories(): Promise<Repository[]>;
  getRepository(repo: RepoRef): Promise<Repository>;
  listBranches(repo: RepoRef): Promise<Branch[]>;
  getBranch(repo: RepoRef, name: string): Promise<Branch | null>;
  createBranch(repo: RepoRef, name: string, from?: string): Promise<Branch>;
  openPullRequest(repo: RepoRef, pr: NewPullRequest): Promise<PullRequest>;
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest>;
  listPullRequests(repo: RepoRef, state?: 'open' | 'closed' | 'all', head?: string): Promise<PullRequest[]>;
  listOpenPullRequests(repo: RepoRef, page: number, perPage: number): Promise<PullRequest[]>;
  listMergedPullRequests(repo: RepoRef, limit: number): Promise<PullRequest[]>;
  closePullRequest(repo: RepoRef, number: number): Promise<void>;
  commentOnPullRequest(repo: RepoRef, number: number, body: string): Promise<Comment>;
  reviewPullRequest(repo: RepoRef, number: number, review: { body: string; comments: InlineComment[] }): Promise<Comment>;
  listReviewThreads(repo: RepoRef, number: number): Promise<ReviewThread[]>;
  resolveReviewThread(repo: RepoRef, number: number, threadId: string): Promise<void>;
  listPullRequestComments(repo: RepoRef, number: number): Promise<Comment[]>;
  listPullRequestFiles(repo: RepoRef, number: number): Promise<PullRequestFile[]>;
  compare(repo: RepoRef, base: string, head: string): Promise<string>;
  listChecks(repo: RepoRef, sha: string): Promise<Check[]>;
  rerunFailed(repo: RepoRef, checks: Check[]): Promise<boolean>;
  getCommitDate(repo: RepoRef, sha: string): Promise<string>;
  retargetPullRequest(repo: RepoRef, number: number, base: string): Promise<void>;
  mergePullRequest(repo: RepoRef, number: number, o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string }): Promise<{ mergeSha: string; branchDeleteError?: string }>;
  queueSupport(repo: RepoRef): Promise<boolean>;
  requiredChecks(repo: RepoRef, branch: string): Promise<string[]>;
  /** Whether `branch` is protected; `null` when the forge does not let this token (or plan) read it. */
  isBranchProtected(repo: RepoRef, branch: string): Promise<boolean | null>;
  fileExists(repo: RepoRef, path: string, ref: string): Promise<boolean>;
  /**
   * Number of issue form files on `ref`: GitHub `.github/ISSUE_TEMPLATE/*.yml|yaml` (not `config.yml`),
   * GitLab `.gitlab/issue_templates/*.md`.
   */
  countIssueForms(repo: RepoRef, ref: string): Promise<number>;
  enqueuePullRequest(repo: RepoRef, number: number, o: { expectSha: string }): Promise<{ state: 'queued' | 'merged'; mergeSha?: string }>;
  dequeuePullRequest(repo: RepoRef, number: number): Promise<void>;
  isQueued(repo: RepoRef, number: number): Promise<boolean>;
  resetBranch(repo: RepoRef, branch: string, sha: string): Promise<void>;
  deleteBranch(repo: RepoRef, branch: string): Promise<void>;
  mergeIntoBranch(repo: RepoRef, branch: string, headSha: string): Promise<{ sha: string } | { conflict: true }>;
  listFiles(repo: RepoRef, ref?: string): Promise<{ commit: string; paths: string[]; truncated?: boolean }>;
  getFile(repo: RepoRef, path: string, ref?: string): Promise<{ content: string; sha: string }>;
  putFile(repo: RepoRef, o: { branch: string; path: string; content: string; message: string; expectSha?: string }): Promise<{ sha: string }>;
  findRelease(repo: RepoRef, o: { sha: string }): Promise<Release | null>;
  createRelease(repo: RepoRef, o: { tag: string; sha: string; name: string; body: string; prerelease?: boolean }): Promise<Release>;
  listReleases(repo: RepoRef): Promise<Release[]>;
  releaseByTag(repo: RepoRef, tag: string): Promise<Release | null>;
  isAncestor(repo: RepoRef, base: string, head: string): Promise<boolean>;
  listTags(repo: RepoRef): Promise<string[]>;
  tagSha(repo: RepoRef, tag: string): Promise<string | null>;
  updateRelease(repo: RepoRef, id: string, o: { body: string }): Promise<Release>;
  latestRelease(repo: RepoRef): Promise<Release | null>;
  listCommits(repo: RepoRef, o: { from?: string; to: string }): Promise<{ sha: string; message: string }[]>;
  webhooks?: Webhooks;
}

/** The forge refused to enqueue the PR (not mergeable, no queue on the branch); the message is the forge's. */
export class NotQueueableError extends Error {}

/** The forge accepted the merge but has not finished it; retry later without counting a failure. */
export class MergePendingError extends Error {}

export interface Backend {
  capabilities: Capabilities;
  forge: Forge;
  tickets(repo: RepoRef): TicketSource;
}
