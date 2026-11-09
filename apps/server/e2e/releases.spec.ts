import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { confirmClick } from './confirm'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
})

test('lists the done Tickets of a manual Product, one ship button, notes preview, Board reminder', async ({ page }) => {
  await expect(page.getByTestId('release-reminder').filter({ hasText: 'Acme Relist: 3 done Tickets have waited' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Releases' }).click()
  await page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Acme Relist' }).click()
  for (const title of ['Relist the export totals', 'Relist the invoice filter', 'Relist the CSV header']) await expect(page.getByRole('checkbox', { name: new RegExp(title) })).toBeChecked()
  const bar = page.getByTestId('action-bar')
  await expect(bar.getByRole('button')).toHaveCount(1)
  await expect(bar.getByRole('button', { name: 'Ship v0.1.0 (3 Tickets)' })).toBeEnabled()
  await expect(page.getByLabel('Version')).toHaveValue('0.1.0')
  await expect(page.getByLabel('Release notes')).toContainText('Relist the export totals')
  await page.getByRole('checkbox', { name: /Relist the CSV header/ }).uncheck()
  await expect(bar.getByRole('button', { name: 'Ship v0.1.0 (2 Tickets)' })).toBeEnabled()
  await expect(page.getByLabel('Release notes')).not.toContainText('Relist the CSV header')
})

test('shipping marks the Tickets Released in the version', async ({ page }) => {
  await page.goto('/releases')
  await page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Acme Reship' }).click()
  const bar = page.getByTestId('action-bar')
  await expect(page.getByLabel('Release notes')).toContainText('Reship the invoice filter')
  await confirmClick(bar.getByRole('button', { name: 'Ship v0.1.0 (2 Tickets)' }), bar.getByRole('button', { name: 'Confirm ship v0.1.0' }), (t) => expect(page.getByRole('link', { name: 'v0.1.0', exact: true })).toBeVisible({ timeout: t }))
  await expect(page.getByText('Every done Ticket is in a release.')).toBeVisible()
  await expect(bar.getByRole('button', { name: /^Ship v/ })).toBeDisabled()
  await page.goto('/?state=all')
  const card = page.locator('.card', { hasText: 'Reship the export totals' }).first()
  await expect(card.getByText('Released in v0.1.0')).toBeVisible()
  await card.getByRole('link', { name: 'Reship the export totals' }).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
  await expect(page.getByRole('main').getByText(/Released in v0\.1\.0/)).toBeVisible()
})
