import { GithubBackend, GitlabBackend } from '@bauherr/adapters'
import { expect, it } from 'vitest'
import { backendFor } from '../src/lib/adapters'
import { webOrigin, type ConnectionInput } from '../src/lib/connection'

const conn = (
  kind: ConnectionInput['kind'],
  config: Record<string, unknown> = {},
  secret: string | null = 's',
): ConnectionInput => ({ id: 1, kind, config, secret, capabilities: {} })

it('webOrigin: github.com, GitLab base URL (default gitlab.com, https only, relative URL root kept)', () => {
  expect(webOrigin(conn('github'))).toBe('https://github.com')
  expect(webOrigin(conn('gitlab'))).toBe('https://gitlab.com')
  expect(webOrigin(conn('gitlab', { baseUrl: 'https://git.example.com/' }))).toBe('https://git.example.com')
  expect(webOrigin(conn('gitlab', { baseUrl: 'https://host.example/gitlab/' }))).toBe('https://host.example/gitlab')
  expect(() => webOrigin(conn('gitlab', { baseUrl: 'http://git.example.com' }))).toThrow('https')
})

it('backendFor builds the backend of the Connection kind and needs a secret', () => {
  expect(backendFor(conn('github'))).toBeInstanceOf(GithubBackend)
  expect(backendFor(conn('gitlab', { baseUrl: 'https://git.example.com' }))).toBeInstanceOf(GitlabBackend)
  expect(() => backendFor(conn('gitlab', {}, null))).toThrow('no secret')
})
