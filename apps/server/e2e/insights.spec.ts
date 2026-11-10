import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Insights' }).click()
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible()
})

const tile = (page: import('@playwright/test').Page, id: string) => page.getByTestId(`tile-${id}`).locator('dd')

test('renders the seeded numbers: tiles, where time goes with its bottleneck, throughput', async ({ page }) => {
  // seed: five Tickets done within 30 days (lead times 26.7 h to 57.9 h, median 35.6 h), three of them within 7 days
  expect(Number(await tile(page, 'done').textContent())).toBeGreaterThanOrEqual(5)
  await expect(tile(page, 'lead-median')).toHaveText(/^1\.\d d$/)
  await expect(tile(page, 'share-queued')).toHaveText(/^\d+ %$/)
  const stages = page.getByTestId('stage-time')
  expect(await stages.evaluateAll((els) => els.map((e) => e.getAttribute('data-stage')))).toEqual(['triage', 'plan', 'build', 'review', 'release'])
  await expect(page.getByTestId('bottleneck')).toContainText('Bottleneck')
  await expect(page.getByTestId('bottleneck')).toContainText(/build: Tickets wait \d+ h for a build slot/)
  await expect(page.locator('[data-stage=build][data-bottleneck]')).toHaveCount(1)
  expect(await page.getByTestId('week').count()).toBeGreaterThanOrEqual(3)
})

test('the range switch changes the numbers; the Product filter narrows them', async ({ page }) => {
  const wide = Number(await tile(page, 'done').textContent())
  await page.getByRole('navigation', { name: 'Range' }).getByRole('link', { name: '7 days' }).click()
  await expect(page).toHaveURL(/range=7/)
  await expect(page.getByTestId('tile-done').locator('dt')).toContainText('last 7 days')
  const narrow = Number(await tile(page, 'done').textContent())
  expect(narrow).toBeGreaterThanOrEqual(3)
  expect(narrow).toBeLessThan(wide)
  await page.getByRole('navigation', { name: 'Range' }).getByRole('link', { name: '90 days' }).click()
  await expect(page).toHaveURL(/range=90/)
  await page.getByLabel('Product').selectOption({ label: 'Acme Shop' })
  await expect(page).toHaveURL(/product=/)
  expect(Number(await tile(page, 'done').textContent())).toBe(0)
  await expect(page.getByText('No Ticket reached done in this range.')).toBeVisible()
})

test('WIP age lists the longest waiting open Tickets first and links to them', async ({ page }) => {
  const rows = page.getByTestId('wip-age').locator('tbody tr')
  await expect(rows.first()).toContainText('Upgrade the payment SDK')
  await expect(rows.first()).toContainText(/1\.\d d/)
  expect(await rows.count()).toBeLessThanOrEqual(10)
  await rows.first().getByRole('link').click()
  await expect(page).toHaveURL(/\/tickets\/\d+$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('#5 Upgrade the payment SDK')
})
