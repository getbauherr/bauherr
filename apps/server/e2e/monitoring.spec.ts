import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { confirmClick } from './confirm'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.describe.configure({ mode: 'serial' }) // Monitoring Connections are instance-wide: one per service, so this spec's tests share them

const signIn = async (page: Page, as: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(as)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const open = async (page: Page, name: string) => {
  await page.goto('/settings/connections')
  const region = page.getByRole('region', { name, exact: true })
  const remove = region.getByRole('button', { name: 'Remove', exact: true })
  if (await remove.isVisible()) {
    await confirmClick(remove, region.getByRole('button', { name: `Yes, remove ${name}` }), () => expect(region.getByRole('button', { name: 'Connect' })).toBeVisible())
  }
  return region
}

const TOKEN = 'tok-e2e-SECRET-1234'

test('Admin saves Grafana, sees Saved without the token, and an unreachable address fails in plain words', async ({ page }) => {
  await signIn(page, email)
  const region = await open(page, 'Grafana')
  await region.getByLabel('Grafana address').fill('http://127.0.0.1:59999')
  await region.getByLabel('Service-account token (optional)').fill(TOKEN)
  await region.getByRole('button', { name: 'Connect' }).click()
  await expect(region.getByText('Token saved, never shown again')).toBeVisible()
  expect(await page.content()).not.toContain(TOKEN)
  await expect(region.getByLabel('Service-account token (optional)')).toHaveValue('')
  await expect(region.getByLabel('Service-account token (optional)')).toHaveAttribute('placeholder', 'unchanged')

  await region.getByRole('button', { name: 'Test connection' }).click()
  await expect(region.getByRole('alert').filter({ hasText: 'Cannot reach http://127.0.0.1:59999 (connection refused)' })).toBeVisible()
  await expect(region.getByText('Failed', { exact: true })).toBeVisible()
  expect(await page.content()).not.toContain(TOKEN)

  await open(page, 'Grafana')
  await expect(page.getByRole('region', { name: 'Grafana', exact: true }).getByRole('button', { name: 'Connect' })).toBeVisible()
})

test('Admin saves Traces and the unreachable endpoint is reported', async ({ page }) => {
  await signIn(page, email)
  const region = await open(page, 'Traces (OTLP)')
  await region.getByLabel('Endpoint').fill('not a host')
  await region.getByRole('button', { name: 'Connect' }).click()
  await expect(region.getByText('must be host:port')).toBeVisible()
  await region.getByLabel('Endpoint').fill('127.0.0.1:59999')
  await region.getByLabel('Traces UI address (optional)').fill('http://127.0.0.1:16686')
  await region.getByRole('button', { name: 'Connect' }).click()
  await expect(region.getByRole('button', { name: 'Test connection' })).toBeVisible()
  await region.getByRole('button', { name: 'Test connection' }).click()
  await expect(region.getByRole('alert').filter({ hasText: 'Cannot reach 127.0.0.1:59999 (connection refused)' })).toBeVisible()
  await open(page, 'Traces (OTLP)')
})

test('a Bauherr gets a 404 on Connections and so sees no Monitoring group', async ({ page }) => {
  await signIn(page, 'monitoring-bauherr@example.com')
  expect((await page.goto('/settings/connections'))?.status()).toBe(404)
})
