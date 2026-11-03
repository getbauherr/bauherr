import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Payload } from 'payload'
import { expect, it, vi } from 'vitest'

vi.mock('payload', async (orig) => ({ ...(await orig<object>()), createLocalReq: async () => ({}) }))
import { mediaBytes } from '../src/lib/intake/media'

const fake = (staticDir: string, handlers: unknown[]) => ({ collections: { media: { config: { upload: { staticDir, handlers } } } } }) as unknown as Payload
const doc = { id: 1, filename: 'a.png' }
const s3 = (res: Response | Error) => async () => {
  if (res instanceof Error) throw res
  return res
}

it('falls back to the local file when the configured S3 store misses', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'media-'))
  await writeFile(path.join(dir, 'a.png'), 'local')
  for (const miss of [new Response('', { status: 404 }), new Error('boom')]) {
    expect(Buffer.from(await mediaBytes(fake(dir, [s3(miss)]), doc)).toString()).toBe('local')
  }
})

it('reads S3 when the local file is missing and S3 is configured', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'media-'))
  expect(Buffer.from(await mediaBytes(fake(dir, [s3(new Response('remote'))]), doc)).toString()).toBe('remote')
})

it('throws unreadable only when every source fails', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'media-'))
  await expect(mediaBytes(fake(dir, [s3(new Response('', { status: 404 }))]), doc)).rejects.toThrow('media 1 unreadable')
  await expect(mediaBytes(fake(dir, []), doc)).rejects.toThrow('media 1 unreadable')
})
