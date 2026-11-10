import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/results',
  workers: Number(process.env.E2E_WORKERS ?? 1), // the e2e-fake job sets 3: its specs own their data (see CONTRIBUTING.md)
  retries: Number(process.env.E2E_RETRIES ?? 0), // CI sets 1 for e2e-fake; a test that passes on retry is listed as flaky in the report, not hidden
  expect: { timeout: 15_000 },
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000', screenshot: 'on' },
})
