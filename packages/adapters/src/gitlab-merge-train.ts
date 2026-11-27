import { IDEMPOTENT } from './retry.js';
import type { PullRequest, RepoRef } from './contracts.js';
import { MergePendingError, NotQueueableError } from './contracts.js';
import { GitlabError } from './gitlab.js';
import type { GitlabApi } from './gitlab-api.js';
import { GitlabMergeRequests } from './gitlab-merge-requests.js';
import { field, get, num, text, wire } from './wire.js';

const enc = encodeURIComponent;
const TRAIN_STATUS_POLL_MS = [500, 1000, 2000, 4000];
const MERGE_POLL_MS = [500, 1000, 2000, 4000, 8000, 15000];
const UNSETTLED_STATUSES = ['checking', 'unchecked', 'preparing'];
const CONFLICT_STATUSES = ['conflict', 'broken_status', 'cannot_be_merged'];
const QUEUED_STATUSES = ['idle', 'fresh', 'stale'];

const detailedStatus = (status: Record<string, unknown>): string =>
  text(status.detailed_merge_status ?? status.merge_status);

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const trainRefusal = (mrNumber: number, branch: string, detailed: string, e: GitlabError): GitlabError =>
  new GitlabError(
    e.status,
    'PUT',
    `merge_requests/${mrNumber}/merge`,
    `GitLab refuses to merge the temporary train MR !${mrNumber} although it has no conflicts ` +
      `(merge status "${detailed}"): ${e.message}. Check the project's merge settings ` +
      `(pipelines must succeed, approvals, protected ${branch}); ` +
      `the train branch must accept merges from the bot.`,
  );

/** Merge trains, train branches and merging a merge request. */
export class GitlabMergeTrain extends GitlabMergeRequests {
  constructor(
    h: GitlabApi,
    protected sleep: (ms: number) => Promise<void>,
  ) {
    super(h);
  }

  async queueSupport(repo: RepoRef) {
    const p = wire(await this.h.json('GET', `/projects/${enc(repo)}`));
    return !!(p.merge_trains_enabled && p.merge_pipelines_enabled);
  }
  async enqueuePullRequest(repo: RepoRef, n: number, o: { expectSha: string }) {
    const before = await this.getPullRequest(repo, n);
    if (before.state === 'merged')
      return { state: 'merged' as const, ...(before.mergeSha ? { mergeSha: before.mergeSha } : {}) };
    try {
      await this.h.json('POST', `/projects/${enc(repo)}/merge_trains/merge_requests/${n}`, {
        sha: o.expectSha,
        auto_merge: true,
        squash: true,
      });
    } catch (e) {
      if (e instanceof GitlabError && [400, 405].includes(e.status)) throw new NotQueueableError(e.message);
      throw e;
    }
    return { state: 'queued' as const };
  }
  async isQueued(repo: RepoRef, n: number) {
    try {
      const entry = await this.h.json('GET', `/projects/${enc(repo)}/merge_trains/merge_requests/${n}`);
      return QUEUED_STATUSES.includes(field(entry, 'status'));
    } catch (e) {
      if (e instanceof GitlabError && e.status === 404) return false;
      throw e;
    }
  }
  async dequeuePullRequest(repo: RepoRef, n: number) {
    try {
      await this.h.json('POST', `/projects/${enc(repo)}/merge_requests/${n}/cancel_merge_when_pipeline_succeeds`);
    } catch (e) {
      if (!(e instanceof GitlabError && [404, 405, 406].includes(e.status))) throw e;
    }
  }

  private async settledMergeStatus(mrPath: string): Promise<{ detailed: string; conflicts: boolean }> {
    let status: Record<string, unknown> = {};
    for (const ms of [0, ...TRAIN_STATUS_POLL_MS]) {
      if (ms) await this.sleep(ms);
      status = wire(await this.h.json('GET', mrPath));
      if (!UNSETTLED_STATUSES.includes(detailedStatus(status))) break;
    }
    return { detailed: detailedStatus(status), conflicts: status.has_conflicts === true };
  }
  private async mergeTrainRequest(mrPath: string, mr: PullRequest, branch: string, headSha: string, detailed: string) {
    try {
      await this.h.json('PUT', `${mrPath}/merge`, { squash: false, should_remove_source_branch: true, sha: headSha });
    } catch (e) {
      if (e instanceof GitlabError && [405, 406, 422].includes(e.status))
        throw trainRefusal(mr.number, branch, detailed, e);
      throw e;
    }
  }
  private async waitForMerged(repo: RepoRef, n: number): Promise<PullRequest> {
    let after = await this.getPullRequest(repo, n);
    for (const ms of MERGE_POLL_MS) {
      if (after.state !== 'open') break;
      await this.sleep(ms);
      after = await this.getPullRequest(repo, n);
    }
    return after;
  }

  async mergeIntoBranch(repo: RepoRef, branch: string, headSha: string) {
    const tip = (await this.getBranch(repo, branch))?.sha;
    if (!tip) throw new Error(`no branch ${branch}`);
    if (await this.isAncestor(repo, headSha, tip)) return { sha: tip };
    const temp = `${branch}-merge-${headSha.slice(0, 12)}`;
    await this.deleteBranch(repo, temp);
    await this.createBranch(repo, temp, headSha);
    const mr = await this.openPullRequest(repo, {
      title: `bauherr train: merge ${headSha.slice(0, 7)} into ${branch}`,
      head: temp,
      base: branch,
    });
    const cleanup = async () => {
      await this.closePullRequest(repo, mr.number).catch(() => undefined);
      await this.deleteBranch(repo, temp);
    };
    const mrPath = `/projects/${enc(repo)}/merge_requests/${mr.number}`;
    try {
      const { detailed, conflicts } = await this.settledMergeStatus(mrPath);
      if (UNSETTLED_STATUSES.includes(detailed))
        throw new MergePendingError(`GitLab has not finished checking whether !${mr.number} merges into ${branch}`);
      if (conflicts || CONFLICT_STATUSES.includes(detailed)) {
        await cleanup();
        return { conflict: true as const };
      }
      await this.mergeTrainRequest(mrPath, mr, branch, headSha, detailed);
    } catch (e) {
      await cleanup();
      throw e;
    }
    const after = await this.waitForMerged(repo, mr.number);
    if (after.state !== 'merged' || !after.mergeSha)
      throw new MergePendingError(`GitLab accepted the train merge of !${mr.number} but it is not merged yet`);
    await this.deleteBranch(repo, temp);
    return { sha: after.mergeSha };
  }

  private async retargetStacked(repo: RepoRef, before: PullRequest): Promise<void> {
    const stacked = await this.h.paginate(
      `/projects/${enc(repo)}/merge_requests?state=opened&target_branch=${enc(before.head)}&per_page=100`,
    );
    for (const s of stacked) await this.retargetPullRequest(repo, num(wire(s).iid), before.base);
  }
  private async mergeAndWait(repo: RepoRef, n: number, expectSha?: string): Promise<PullRequest> {
    const project = await this.h.json('GET', `/projects/${enc(repo)}`);
    await this.h.json('PUT', `/projects/${enc(repo)}/merge_requests/${n}/merge`, {
      squash: get(project, 'squash_option') !== 'never',
      ...(expectSha ? { sha: expectSha } : {}),
    });
    return this.waitForMerged(repo, n);
  }

  async mergePullRequest(
    repo: RepoRef,
    n: number,
    o: { method: 'squash'; deleteBranch?: boolean; expectSha?: string },
  ) {
    const before = await this.getPullRequest(repo, n);
    const after = before.state === 'merged' ? before : await this.mergeAndWait(repo, n, o.expectSha);
    if (after.state === 'open')
      throw new MergePendingError(`GitLab accepted the merge of !${n} but it is not merged yet`);
    if (!after.mergeSha)
      throw new GitlabError(
        0,
        'PUT',
        `merge_requests/${n}/merge`,
        `merge of !${n} left no merge sha (state ${after.state})`,
      );
    let branchDeleteError: string | undefined;
    if (o.deleteBranch && before.headRepo.toLowerCase() === before.baseRepo.toLowerCase()) {
      try {
        await this.retargetStacked(repo, before);
      } catch (e) {
        return {
          mergeSha: after.mergeSha,
          branchDeleteError: `kept ${before.head}: retargeting stacked MRs failed: ${errorMessage(e)}`,
        };
      }
      const branch = `/projects/${enc(repo)}/repository/branches/${enc(before.head)}`;
      await this.h.json('DELETE', branch, undefined, IDEMPOTENT).catch((e) => {
        if (!(e instanceof GitlabError && e.status === 404)) branchDeleteError = errorMessage(e);
      });
    }
    return { mergeSha: after.mergeSha, ...(branchDeleteError ? { branchDeleteError } : {}) };
  }
}
