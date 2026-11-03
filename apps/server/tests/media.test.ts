import { beforeAll, expect, it } from 'vitest'

let m: typeof import('../src/lib/intake/media')

beforeAll(async () => {
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  m = await import('../src/lib/intake/media')
})

it('limits come from the environment with 5 MiB and 5 as defaults', () => {
  delete process.env.MEDIA_MAX_BYTES
  delete process.env.MEDIA_MAX_PER_SESSION
  expect(m.mediaLimits()).toEqual({ maxBytes: 5 * 1024 * 1024, maxPerSession: 5 })
  process.env.MEDIA_MAX_BYTES = '1000'
  process.env.MEDIA_MAX_PER_SESSION = '2'
  expect(m.mediaLimits()).toEqual({ maxBytes: 1000, maxPerSession: 2 })
  delete process.env.MEDIA_MAX_BYTES
  delete process.env.MEDIA_MAX_PER_SESSION
})

it('sniff rejects svg and html whatever the name says', () => {
  const b = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
  expect(m.sniff(b('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
  expect(m.sniff(b('<html><script>alert(1)</script>'))).toBeNull()
})

it('mediaUrl is /m/<id>/<sig>.<ext>; the signature accepts that id only', () => {
  process.env.PUBLIC_URL = 'https://bauherr.test/'
  const url = m.mediaUrl(42, 'image/png')
  const [, id, rest] = url.match(/^https:\/\/bauherr\.test\/m\/(\d+)\/([\w-]+\.png)$/)!
  expect(id).toBe('42')
  expect(m.mediaUrl(42, 'image/jpeg')).toMatch(/\.jpg$/)
  expect(m.verifyMediaSig(42, rest!)).toBe(true)
  expect(m.verifyMediaSig(43, rest!)).toBe(false)
  expect(m.verifyMediaSig(42, `${rest!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))}`)).toBe(false)
  expect(m.verifyMediaSig(42, 'short')).toBe(false)
  expect(m.mediaUrl(42, 'image/png')).toBe(url)
})
