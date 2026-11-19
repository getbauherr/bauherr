import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)) } },
  test: { include: ['tests/**/*.integration.ts'], testTimeout: 60_000, hookTimeout: 120_000 },
})
