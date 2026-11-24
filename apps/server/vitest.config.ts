import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src/app/(app)', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['tests/global-setup.ts'],
    projects: [
      {
        extends: true,
        test: { name: 'server', include: ['tests/**/*.test.ts'], exclude: ['tests/ui/**'] },
      },
      {
        extends: true,
        test: { name: 'ui', include: ['tests/ui/**/*.test.ts'], environment: 'jsdom' },
      },
    ],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
