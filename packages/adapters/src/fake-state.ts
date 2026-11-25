import { createHash } from 'node:crypto';
import type {
  Check,
  CloseReason,
  Comment,
  Deployment,
  InlineComment,
  LabelEvent,
  PullRequest,
  Release,
} from './contracts.js';
import type { Relations } from './body-convention.js';

export interface FakeTicket {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  author: string;
  createdAt: string;
  closedAt?: string;
  updatedAt: string;
  closeReason: CloseReason | null;
  rel: Relations;
  comments: Comment[];
  events: LabelEvent[];
}
export interface FakeRepo {
  defaultBranch: string;
  branches: Map<string, { sha: string; files: Map<string, string> }>;
  prs: PullRequest[];
  checks: Map<string, Check[]>;
  rerunChecks: Map<string, Check[]>;
  reruns: Check[][];
  reviews: { number: number; body: string; comments: InlineComment[] }[];
  resolvedThreads: Set<string>;
  commitDates: Map<string, string>;
  releases: Release[];
  tags: string[];
  tagShas: Map<string, string>;
  contains: Map<string, string[]>;
  commits: { sha: string; message: string }[];
  ancestors: Map<string, string[]>;
  queueSupport: boolean;
  requiredChecks: string[];
  branchProtected: boolean | null;
  deployments: Map<string, Deployment>;
  deployStarts: { workflow: string; ref: string; inputs: Record<string, string> }[];
  commitEndpoint: boolean;
  canWrite: boolean;
  queue: number[];
  issued: number;
  snapshots: Map<string, Map<string, string>>;
}

export const blobSha = (c: string): string => createHash('sha1').update(c).digest('hex');

export interface FakeAccess {
  repo(name: string): FakeRepo;
  repoNames(): string[];
  nextSeq(): number;
}
