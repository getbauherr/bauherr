import { GithubBackend, GitlabBackend } from '@bauherr/adapters'
import { expect, it } from 'vitest'
import { backendFor } from '../src/lib/adapters'
import { webOrigin, type ConnectionInput } from '../src/lib/connection'
import { prNumber } from '../src/lib/release'

const conn = (kind: ConnectionInput['kind'], config: Record<string, unknown> = {}, secret: string | null = 's'): ConnectionInput => ({ id: 1, kind, config, secret, capabilities: {} })

it('prNumber accepts only <web>/<repo>/pull|-/merge_requests/<n> on the Connection origin', () => {
  const gh = 'https://github.com'
  const gl = 'https://git.example.org'
  expect(prNumber(`${gh}/acme/web/pull/12`, 'acme/web', gh)).toBe(12)
  expect(prNumber(`${gl}/grp/sub/proj/-/merge_requests/196`, 'grp/sub/proj', gl)).toBe(196)
  for (const [url, repo, web] of [
    [`https://evil.example/acme/web/pull/1`, 'acme/web', gh],
    [`${gh}/acme/web/pull/1`, 'acme/web', gl],
    [`${gl}/other/proj/-/merge_requests/1`, 'grp/sub/proj', gl],
    [`${gl}/grp/sub/proj/-/merge_requests/1/diffs`, 'grp/sub/proj', gl],
    [`${gl}/grp/sub/proj/-/issues/1`, 'grp/sub/proj', gl],
    [`https://git.example.org.evil.io/grp/sub/proj/-/merge_requests/1`, 'grp/sub/proj', gl],
    ['nope', 'acme/web', gh],
    [undefined, 'acme/web', gh],
  ] as const) expect(prNumber(url, repo, web)).toBeNull()
})

it('webOrigin: github.com, GitLab base URL (default gitlab.com, https only, path dropped)', () => {
  expect(webOrigin(conn('github'))).toBe('https://github.com')
  expect(webOrigin(conn('gitlab'))).toBe('https://gitlab.com')
  expect(webOrigin(conn('gitlab', { baseUrl: 'https://git.einsfuenf.de/' }))).toBe('https://git.einsfuenf.de')
  expect(() => webOrigin(conn('gitlab', { baseUrl: 'http://git.einsfuenf.de' }))).toThrow('https')
})

it('backendFor builds the backend of the Connection kind and needs a secret', () => {
  expect(backendFor(conn('github'))).toBeInstanceOf(GithubBackend)
  expect(backendFor(conn('gitlab', { baseUrl: 'https://git.einsfuenf.de' }))).toBeInstanceOf(GitlabBackend)
  expect(() => backendFor(conn('gitlab', {}, null))).toThrow('no secret')
})
