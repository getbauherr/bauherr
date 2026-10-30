import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/results',
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000', screenshot: 'on' },
})
