import { afterEach, expect, it, vi } from 'vitest'

const build = async () => {
  vi.resetModules()
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const config = await (await import('../src/payload.config')).default
  return config.collections.find((c) => c.slug === 'media')!.upload as { handlers?: unknown[]; disableLocalStorage?: boolean }
}

afterEach(() => {
  for (const k of ['MEDIA_S3_BUCKET', 'MEDIA_S3_ENDPOINT', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY']) delete process.env[k]
})

it('media stays on the local volume without MEDIA_S3_BUCKET', async () => {
  const upload = await build()
  expect(upload.handlers?.length ?? 0).toBe(0)
  expect(upload.disableLocalStorage).toBeFalsy()
})

it('media uses the S3 adapter once the bucket and keys are set', async () => {
  Object.assign(process.env, { MEDIA_S3_BUCKET: 'b', MEDIA_S3_ENDPOINT: 'http://127.0.0.1:9000', MEDIA_S3_ACCESS_KEY_ID: 'k', MEDIA_S3_SECRET_ACCESS_KEY: 's' })
  const upload = await build()
  expect(upload.handlers?.length).toBeGreaterThan(0)
  expect(upload.disableLocalStorage).toBe(true)
})
