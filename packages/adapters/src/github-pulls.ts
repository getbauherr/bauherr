import type {
  Check,
  Comment,
  InlineComment,
  NewPullRequest,
  PullRequest,
  PullRequestFile,
  RepoRef,
  ReviewThread,
} from './contracts.js';
import { GithubError } from './github-error.js';
import { encodePath, GithubForgeBase } from './github-forge-base.js';
import { githubCheckRun, githubComment, githubCommitStatus, githubPull } from './github-mappers.js';
import { githubReviewStamps } from './forge-fields.js';
import { field, get, idText, list, num, wire } from './wire.js';

const enc = encodeURIComponent;

const REVIEW_THREADS_QUERY =
  'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){' +
  'reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{body}}}}}}}';

const reviewThread = (node: unknown): ReviewThread => ({
  id: field(node, 'id'),
  body: field(list(get(node, 'comments', 'nodes'))[0], 'body'),
  resolved: wire(node).isResolved === true,
});

const reviewComment = (review: unknown): Comment => ({
  id: `review-${idText(wire(review).id)}`,
  author: field(wire(review).user, 'login'),
  body: field(review, 'body'),
  ...githubReviewStamps(review),
});

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Pull requests, reviews, merging and checks. */
export class GithubPulls extends GithubForgeBase {
  async openPullRequest(repo: RepoRef, p: NewPullRequest) {
    return githubPull(
      await this.h.json('POST', `/repos/${repo}/pulls`, {
        title: p.title,
        body: p.body ?? '',
        head: p.head,
        base: p.base,
      }),
    );
  }
  async getPullRequest(repo: RepoRef, n: number) {
    return githubPull(await this.h.json('GET', `/repos/${repo}/pulls/${n}`));
  }
  async listPullRequests(repo: RepoRef, state: 'open' | 'closed' | 'all' = 'open', head?: string) {
    const byHead = head ? `&head=${enc(`${repo.split('/')[0]}:${head}`)}` : '';
    return (await this.h.paginate(`/repos/${repo}/pulls?state=${state}&per_page=100${byHead}`)).map(githubPull);
  }
  async listOpenPullRequests(repo: RepoRef, page: number, perPage: number) {
    const query = `state=open&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
    return list(await this.h.json('GET', `/repos/${repo}/pulls?${query}`)).map(githubPull);
  }
  async listMergedPullRequests(repo: RepoRef, limit: number) {
    const out: PullRequest[] = [];
    for (let page = 1; out.length < limit && page <= 5; page++) {
      const batch = list(
        await this.h.json(
          'GET',
          `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
        ),
      );
      out.push(...batch.map(githubPull).filter((p) => p.state === 'merged'));
      if (batch.length < 100) break;
    }
    return out.slice(0, limit);
  }
  async closePullRequest(repo: RepoRef, n: number) {
    await this.h.json('PATCH', `/repos/${repo}/pulls/${n}`, { state: 'closed' });
  }
  async commentOnPullRequest(repo: RepoRef, n: number, body: string) {
    return githubComment(await this.h.json('POST', `/repos/${repo}/issues/${n}/comments`, { body }));
  }
  async reviewPullRequest(repo: RepoRef, n: number, r: { body: string; comments: InlineComment[] }) {
    const x = await this.h.json('POST', `/repos/${repo}/pulls/${n}/reviews`, {
      event: 'COMMENT',
      body: r.body,
      comments: r.comments.map((c) => ({ path: c.path, line: c.line, side: 'RIGHT', body: c.body })),
    });
    return {
      id: idText(wire(x).id),
      author: field(wire(x).user, 'login'),
      body: field(x, 'body'),
      ...githubReviewStamps(x),
    };
  }
  async listReviewThreads(repo: RepoRef, n: number) {
    const [owner, name] = repo.split('/');
    const d = await this.graphql(REVIEW_THREADS_QUERY, { o: owner, n: name, p: n });
    return list(get(d, 'repository', 'pullRequest', 'reviewThreads', 'nodes')).map(reviewThread);
  }
  async resolveReviewThread(_repo: RepoRef, _n: number, threadId: string) {
    await this.graphql('mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}', { id: threadId });
  }
  async listPullRequestComments(repo: RepoRef, n: number) {
    const reviews = (await this.h.paginate(`/repos/${repo}/pulls/${n}/reviews?per_page=100`)).filter(
      (x) => wire(x).body,
    );
    return [
      ...(await this.h.paginate(`/repos/${repo}/issues/${n}/comments?per_page=100`)).map(githubComment),
      ...reviews.map(reviewComment),
    ];
  }
  async listPullRequestFiles(repo: RepoRef, n: number): Promise<PullRequestFile[]> {
    return (await this.h.paginate(`/repos/${repo}/pulls/${n}/files?per_page=100`)).map((f) => ({
      filename: field(f, 'filename'),
      status: field(f, 'status'),
      additions: num(wire(f).additions),
      deletions: num(wire(f).deletions),
    }));
  }
  async retargetPullRequest(repo: RepoRef, n: number, base: string) {
    await this.h.json('PATCH', `/repos/${repo}/pulls/${n}`, { base });
  }
  async mergePullRequest(
    repo: RepoRef,
    n: number,
    o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string },
  ) {
    const p = await this.getPullRequest(repo, n);
    const m = await this.h.json('PUT', `/repos/${repo}/pulls/${n}/merge`, {
      merge_method: o.method,
      ...(o.expectSha ? { sha: o.expectSha } : {}),
    });
    const mergeSha = field(m, 'sha');
    let branchDeleteError: string | undefined;
    if (o.deleteBranch && p.headRepo.toLowerCase() === p.baseRepo.toLowerCase()) {
      try {
        for (const s of await this.h.paginate(
          `/repos/${repo}/pulls?state=open&base=${encodeURIComponent(p.head)}&per_page=100`,
        ))
          await this.retargetPullRequest(repo, num(wire(s).number), p.base);
      } catch (e) {
        return {
          mergeSha,
          branchDeleteError: `kept ${p.head}: retargeting stacked PRs failed: ${errorMessage(e)}`,
        };
      }
      await this.h.json('DELETE', `/repos/${repo}/git/refs/heads/${encodePath(p.head)}`).catch((e) => {
        if (!(e instanceof GithubError && [404, 422].includes(e.status))) branchDeleteError = errorMessage(e);
      });
    }
    return { mergeSha, ...(branchDeleteError ? { branchDeleteError } : {}) };
  }
  async rerunFailed(repo: RepoRef, checks: Check[]): Promise<boolean> {
    const runs = [...new Set(checks.map((c) => c.runId).filter((r): r is number => !!r))];
    await Promise.all(runs.map((r) => this.h.json('POST', `/repos/${repo}/actions/runs/${r}/rerun-failed-jobs`)));
    return runs.length > 0;
  }
  async listChecks(repo: RepoRef, sha: string): Promise<Check[]> {
    const runs = (
      await this.h.paginate(`/repos/${repo}/commits/${sha}/check-runs?filter=latest&per_page=100`, (p) =>
        list(wire(p).check_runs),
      )
    ).map(githubCheckRun);
    const combined = await this.h.json('GET', `/repos/${repo}/commits/${sha}/status?per_page=100`);
    return [...runs, ...list(wire(combined).statuses).map(githubCommitStatus)];
  }
}
