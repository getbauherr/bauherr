import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)), '@': fileURLToPath(new URL('./src/app/(app)', import.meta.url)) } },
  test: { globalSetup: ['tests/global-setup.ts'], env: { MEDIA_DIR: join(tmpdir(), 'bauherr-test-media') }, include: ['tests/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 120_000 },
})
