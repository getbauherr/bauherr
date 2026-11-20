import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyGithub, verifyGitlab } from '../../src/core/hooks/verify'

const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

describe('delivery verification', () => {
  const raw = Buffer.from('{"a":1}')

  it('accepts a GitHub signature over the raw body and refuses every other', () => {
    expect(verifyGithub('s3', raw, sign('s3', '{"a":1}'))).toBe(true)
    expect(verifyGithub('s3', raw, sign('other', '{"a":1}'))).toBe(false)
    expect(verifyGithub('s3', raw, sign('s3', '{"a":2}'))).toBe(false)
    expect(verifyGithub('s3', raw, 'sha256=short')).toBe(false)
    expect(verifyGithub('s3', raw, null)).toBe(false)
  })

  it('accepts the GitLab token and refuses every other', () => {
    expect(verifyGitlab('s3', 's3')).toBe(true)
    expect(verifyGitlab('s3', 's4')).toBe(false)
    expect(verifyGitlab('s3', 's3-longer')).toBe(false)
    expect(verifyGitlab('s3', null)).toBe(false)
  })
})
