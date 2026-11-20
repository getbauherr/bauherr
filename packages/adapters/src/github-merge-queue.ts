import type { RepoRef } from './contracts.js';
import { NotQueueableError } from './contracts.js';
import { GithubError } from './github-error.js';
import { GithubPulls } from './github-pulls.js';
import { field, get } from './wire.js';

const MERGE_QUEUE_QUERY =
  'query($o:String!,$n:String!,$b:String!){repository(owner:$o,name:$n){mergeQueue(branch:$b){id}}}';
const QUEUE_ENTRY_QUERY =
  'query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){mergeQueueEntry{id}}}}';

/** The merge queue of a repository. */
export class GithubMergeQueue extends GithubPulls {
  async queueSupport(repo: RepoRef) {
    const [owner, name] = repo.split('/');
    const d = await this.graphql(MERGE_QUEUE_QUERY, {
      o: owner,
      n: name,
      b: (await this.getRepository(repo)).defaultBranch,
    });
    return !!get(d, 'repository', 'mergeQueue');
  }
  async enqueuePullRequest(repo: RepoRef, n: number, o: { expectSha: string }) {
    const p = await this.getPullRequest(repo, n);
    if (p.state === 'merged') return { state: 'merged' as const, ...(p.mergeSha ? { mergeSha: p.mergeSha } : {}) };
    try {
      await this.h.json('PUT', `/repos/${repo}/pulls/${n}/merge-async`, {
        merge_action: 'merge_queue',
        sha: o.expectSha,
      });
    } catch (e) {
      if (e instanceof GithubError && [400, 405].includes(e.status)) throw new NotQueueableError(e.message);
      if (!(e instanceof GithubError && e.status === 409)) throw e;
    }
    return { state: 'queued' as const };
  }
  async isQueued(repo: RepoRef, n: number) {
    const [owner, name] = repo.split('/');
    const d = await this.graphql(QUEUE_ENTRY_QUERY, { o: owner, n: name, p: n });
    return !!get(d, 'repository', 'pullRequest', 'mergeQueueEntry');
  }
  async dequeuePullRequest(repo: RepoRef, n: number) {
    if (!(await this.isQueued(repo, n))) return;
    await this.graphql('mutation($id:ID!){dequeuePullRequest(input:{id:$id}){clientMutationId}}', {
      id: field(await this.h.json('GET', `/repos/${repo}/pulls/${n}`), 'node_id'),
    });
  }
}
