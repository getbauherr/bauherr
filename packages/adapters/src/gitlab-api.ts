import { GitlabHttp } from './gitlab.js';

export class GitlabApi extends GitlabHttp {
  override json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return super.json<T>(method, path, body);
  }

  override paginate<T = unknown>(path: string): Promise<T[]> {
    return super.paginate<T>(path);
  }
}
