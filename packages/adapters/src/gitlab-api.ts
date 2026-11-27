import { GitlabHttp } from './gitlab.js';
import type { WriteOptions } from './retry.js';

export class GitlabApi extends GitlabHttp {
  override json<T = unknown>(method: string, path: string, body?: unknown, opts?: WriteOptions): Promise<T> {
    return super.json<T>(method, path, body, opts);
  }

  override paginate<T = unknown>(path: string): Promise<T[]> {
    return super.paginate<T>(path);
  }
}
