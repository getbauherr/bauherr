import type { Check, Comment, Release, Repository, TicketSummary } from './contracts.js';
import { gitlabIssueFields, gitlabNoteUpdatedAt, secs } from './forge-fields.js';
import { field, get, idText, list, maybeText, nullableText, num, text, wire } from './wire.js';

export const gitlabSummary = (issue: unknown): TicketSummary => {
  const w = wire(issue);
  return {
    id: idText(w.iid),
    number: num(w.iid),
    url: text(w.web_url),
    title: text(w.title),
    state: w.state === 'opened' ? 'open' : 'closed',
    labels: list(w.labels).map(text),
    assignee: nullableText(get(list(w.assignees)[0], 'username')),
    assignees: list(w.assignees).map((a) => field(a, 'username')),
    updatedAt: secs(text(w.updated_at)),
    ...gitlabIssueFields(issue),
  };
};

export const gitlabNote = (value: unknown): Comment => {
  const w = wire(value);
  return {
    id: idText(w.id),
    author: field(w.author, 'username'),
    body: text(w.body),
    createdAt: secs(text(w.created_at)),
    updatedAt: gitlabNoteUpdatedAt(value),
  };
};

export const gitlabRepository = (value: unknown): Repository => {
  const w = wire(value);
  return {
    fullName: text(w.path_with_namespace),
    defaultBranch: text(w.default_branch),
    private: w.visibility === 'private',
    url: text(w.web_url),
  };
};

export const gitlabCheck = (job: unknown): Check => {
  const w = wire(job);
  const done = (conclusion: string): Check => ({
    id: num(w.id),
    name: text(w.name),
    status: 'completed',
    conclusion,
  });
  switch (w.status) {
    case 'success':
      return done('success');
    case 'failed':
      return done(w.allow_failure ? 'neutral' : 'failure');
    case 'canceled':
      return done('cancelled');
    case 'skipped':
    case 'manual':
      return done('skipped');
    default:
      return { id: num(w.id), name: text(w.name), status: 'in_progress', conclusion: null };
  }
};

const PRERELEASE_TAG = /^v?\d+\.\d+\.\d+-/;

export const isGitlabPrerelease = (tag: string): boolean => PRERELEASE_TAG.test(tag);

export const gitlabRelease = (value: unknown): Release => {
  const w = wire(value);
  const tag = text(w.tag_name);
  return {
    id: tag,
    tag,
    sha: field(w.commit, 'id'),
    name: maybeText(w.name) ?? tag,
    body: text(w.description),
    url: field(w._links, 'self'),
    createdAt: maybeText(w.created_at) ?? maybeText(w.released_at),
    prerelease: isGitlabPrerelease(tag),
  };
};
