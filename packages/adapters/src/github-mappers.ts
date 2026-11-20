import type { Check, Comment, PullRequest, Release, Repository, TicketState, TicketSummary } from './contracts.js';
import { githubCommentUpdatedAt, githubIssueFields, githubPullFields } from './forge-fields.js';
import { field, flag, get, idText, labelName, list, maybeText, nullableText, num, text, wire } from './wire.js';

const ticketState = (value: unknown): TicketState => (value === 'closed' ? 'closed' : 'open');

export const githubSummary = (issue: unknown): TicketSummary => {
  const w = wire(issue);
  return {
    id: idText(w.number),
    number: num(w.number),
    url: text(w.html_url),
    title: text(w.title),
    state: ticketState(w.state),
    labels: list(w.labels).map(labelName),
    assignee: nullableText(get(w, 'assignee', 'login')),
    assignees: list(w.assignees).map((a) => field(a, 'login')),
    updatedAt: text(w.updated_at),
    ...githubIssueFields(issue),
  };
};

export const githubComment = (value: unknown): Comment => {
  const w = wire(value);
  return {
    id: idText(w.id),
    author: field(w.user, 'login'),
    body: text(w.body),
    createdAt: text(w.created_at),
    updatedAt: githubCommentUpdatedAt(value),
  };
};

export const isGithubIssue = (value: unknown): boolean => !wire(value).pull_request;

const pullState = (w: Record<string, unknown>): PullRequest['state'] => {
  if (w.merged_at) return 'merged';
  return w.state === 'closed' ? 'closed' : 'open';
};

const mergeFlags = (w: Record<string, unknown>): Pick<PullRequest, 'mergeable' | 'behind' | 'mergeSha'> => ({
  ...(w.mergeable === false || w.mergeable_state === 'dirty'
    ? { mergeable: false }
    : w.mergeable === true
      ? { mergeable: true }
      : {}),
  ...(w.mergeable_state === 'behind' ? { behind: true } : {}),
  ...(w.merge_commit_sha && w.merged_at ? { mergeSha: text(w.merge_commit_sha) } : {}),
});

export const githubPull = (value: unknown): PullRequest => {
  const w = wire(value);
  return {
    number: num(w.number),
    url: text(w.html_url),
    title: text(w.title),
    body: text(w.body),
    state: pullState(w),
    head: field(w.head, 'ref'),
    base: field(w.base, 'ref'),
    headSha: field(w.head, 'sha'),
    headRepo: field(get(w, 'head', 'repo'), 'full_name'),
    baseRepo: field(get(w, 'base', 'repo'), 'full_name'),
    draft: !!w.draft,
    ...githubPullFields(value),
    ...mergeFlags(w),
  };
};

export const githubRepository = (value: unknown): Repository => {
  const w = wire(value);
  return {
    fullName: text(w.full_name),
    defaultBranch: text(w.default_branch),
    private: flag(w.private),
    url: text(w.html_url),
  };
};

export const githubCheckRun = (value: unknown): Check => {
  const w = wire(value);
  const url = text(w.html_url);
  const runId = Number(/\/actions\/runs\/(\d+)/.exec(url)?.[1]);
  const output = text(get(w, 'output', 'text'));
  return {
    id: num(w.id),
    name: text(w.name),
    status: text(w.status),
    conclusion: nullableText(w.conclusion),
    startedAt: maybeText(w.started_at),
    url: url || undefined,
    ...(runId && { runId }),
    ...(output && { output }),
  };
};

export const githubCommitStatus = (value: unknown): Check => {
  const w = wire(value);
  const name = text(w.context);
  const startedAt = text(w.created_at);
  return w.state === 'pending'
    ? { name, status: 'in_progress', conclusion: null, startedAt }
    : { name, status: 'completed', conclusion: w.state === 'success' ? 'success' : 'failure', startedAt };
};

export const githubRelease = (value: unknown, sha: string): Release => {
  const w = wire(value);
  const tag = text(w.tag_name);
  return {
    id: idText(w.id),
    tag,
    sha,
    name: maybeText(w.name) ?? tag,
    body: text(w.body),
    url: text(w.html_url),
    prerelease: !!w.prerelease,
    createdAt: maybeText(w.created_at),
  };
};
