import { Http } from './github.js';
import type { WriteOptions } from './retry.js';

export class GithubApi extends Http {
  override json<T = unknown>(method: string, path: string, body?: unknown, opts?: WriteOptions): Promise<T> {
    return super.json<T>(method, path, body, opts);
  }

  override paginate<T = unknown>(path: string, pick?: (page: unknown) => T[]): Promise<T[]> {
    return super.paginate<T>(path, pick);
  }
}
