export class GithubError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
    detail: string,
  ) {
    super(`GitHub ${method} ${path} -> ${status}: ${detail.slice(0, 300)}`);
  }
}
