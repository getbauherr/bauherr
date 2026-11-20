import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const digest = (value: string): Buffer => createHash('sha256').update(value).digest()

export const verifyGithub = (secret: string, raw: Uint8Array, signature: string | null): boolean => {
  if (signature === null) return false
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
  const given = Buffer.from(signature)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export const verifyGitlab = (secret: string, token: string | null): boolean =>
  token !== null && timingSafeEqual(digest(token), digest(secret))
