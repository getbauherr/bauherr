import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startGitHttp, type GitHttp } from './git-http'

let http: GitHttp

beforeAll(async () => {
  http = await startGitHttp(join(mkdtempSync(join(tmpdir(), 'git-http-')), 'owner', 'repo.git'))
})

afterAll(() => http.close())

describe('the git server of the tests', () => {
  it('answers when the backend exits before it has read the body', async () => {
    const body = Buffer.alloc(4 * 1024 * 1024, 1)
    const response = await fetch(`${http.url}/missing.git/git-receive-pack`, { method: 'POST', body })
    expect(response.status).toBe(404)
  })
})
