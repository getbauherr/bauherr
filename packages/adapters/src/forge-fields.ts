import { closingIssues } from './closing-issues.js';
import { field, labelName, list, text, wire } from './wire.js';

const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const PROJECT_BOT = /^(project|group)_\d+_bot/;

const closed = (value: unknown): { closedAt?: string } => (typeof value === 'string' ? { closedAt: value } : {});

export const secs = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z');

export const githubIssueFields = (issue: unknown) => {
  const w = wire(issue);
  const user = wire(w.user);
  return {
    createdAt: text(w.created_at),
    ...closed(w.closed_at),
    author: text(user.login),
    authorTrusted: TRUSTED_ASSOCIATIONS.includes(text(w.author_association)),
    authorIsBot: user.type === 'Bot',
  };
};

export const githubPullFields = (pull: unknown) => {
  const w = wire(pull);
  return {
    ...githubIssueFields(pull),
    updatedAt: text(w.updated_at),
    labels: list(w.labels).map(labelName),
    assignees: list(w.assignees).map((a) => field(a, 'login')),
    closes: closingIssues(text(w.body)),
  };
};

export const githubCommentUpdatedAt = (comment: unknown): string =>
  field(comment, 'updated_at') || field(comment, 'created_at');

const isGitlabBot = (author: unknown): boolean =>
  wire(author).bot === true || PROJECT_BOT.test(field(author, 'username'));

export const gitlabAuthorId = (item: unknown): number | undefined => {
  const id = wire(wire(item).author).id;
  return typeof id === 'number' ? id : undefined;
};

export const gitlabIssueFields = (issue: unknown) => {
  const w = wire(issue);
  const closedAt = w.closed_at;
  return {
    createdAt: secs(text(w.created_at)),
    ...closed(typeof closedAt === 'string' ? secs(closedAt) : closedAt),
    author: field(w.author, 'username'),
    authorTrusted: false,
    authorIsBot: isGitlabBot(w.author),
  };
};

export const gitlabMergeRequestFields = (merge: unknown) => {
  const w = wire(merge);
  const ended = w.closed_at ?? w.merged_at;
  return {
    ...gitlabIssueFields({ ...w, closed_at: ended }),
    updatedAt: secs(text(w.updated_at)),
    labels: list(w.labels).map(text),
    assignees: list(w.assignees).map((a) => field(a, 'username')),
    closes: closingIssues(text(w.description)),
  };
};

export const gitlabNoteUpdatedAt = (note: unknown): string =>
  secs(field(note, 'updated_at') || field(note, 'created_at'));

export const githubReviewStamps = (review: unknown): { createdAt: string; updatedAt: string } => {
  const at = field(review, 'submitted_at');
  return { createdAt: at, updatedAt: at };
};
