import { defineConfig } from '@playwright/test'

const env = process.env
const hasCredentials = Boolean(env.E2E_EMAIL && env.E2E_PASSWORD_FILE)
const hasFakeForge = Boolean(env.E2E_FAKE_FORGE)
const hasAdminEnabled = env.E2E_ADMIN_ENABLED === '1'
const hasOidc = Boolean(env.E2E_OIDC)

const signInSpecs = [
  'a11y',
  'admin-pages',
  'gateway',
  'memory',
  'memory-editor',
  'retro',
  'people',
  'perf',
  'product-settings',
  'selects',
  'settings',
  'shell',
  'workspace-delete',
].map((name) => `${name}.spec.ts`)

const testIgnore = [...(hasCredentials ? [] : signInSpecs), ...(hasFakeForge ? ['perf.spec.ts'] : [])]

const grepInvert = [
  ...(hasFakeForge ? [] : [/@fake-forge/]),
  ...(hasAdminEnabled ? [/@admin-disabled/] : [/@admin-enabled/]),
  ...(hasOidc ? [] : [/@oidc/]),
]

export default defineConfig({
  testDir: 'e2e',
  testIgnore,
  grepInvert,
  outputDir: 'e2e/results',
  workers: Number(env.E2E_WORKERS ?? 1),
  retries: Number(env.E2E_RETRIES ?? 0),
  expect: { timeout: 15_000 },
  use: { baseURL: env.BASE_URL ?? 'http://localhost:3000', screenshot: 'on' },
})
