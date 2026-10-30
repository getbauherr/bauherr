import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'View' })).toBeVisible()
  await page.goto('/?view=list')
})

const open = async (page: import('@playwright/test').Page, title: string) => {
  const row = page.locator('ul.list li', { hasText: title }).first()
  await expect(row.getByText('Accept on staging')).toBeVisible()
  await row.getByRole('link', { name: title }).click()
}

test('accept on staging moves the Ticket to done', async ({ page }) => {
  await open(page, 'Ship the CSV export')
  await expect(page.getByRole('heading', { name: 'Accept on staging' })).toBeVisible()
  await expect(page.getByText('CSV export for invoices.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open staging' })).toHaveAttribute('href', 'https://staging.example.com')
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByText('✓ Accepted on staging')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(page.locator('.pipe li[aria-current=step]')).toHaveText('done')
})

test('request changes sends the Ticket back to build', async ({ page }) => {
  await open(page, 'Ship the invoice filter')
  await page.getByLabel('What needs to change').fill('The filter ignores the date range')
  await page.getByRole('button', { name: 'Request changes' }).click()
  await expect(page.locator('.pipe li[aria-current=step]')).toHaveText('build')
  await expect(page.getByRole('heading', { name: 'Accept on staging' })).toHaveCount(0)
})

test('dependencies are visible on rows and the Ticket page', async ({ page }) => {
  const row = page.locator('ul.list li', { hasText: 'Blocked: add the invoice filter' }).first()
  await expect(row.getByText('Blocked', { exact: true })).toHaveAttribute('title', 'Blocked by #8')
  await row.getByRole('link', { name: 'Blocked: add the invoice filter' }).click()
  await expect(page.getByText('Blocked by #8 Blocker: migrate the invoice table')).toBeVisible()
  await page.getByRole('link', { name: '#8 Blocker: migrate the invoice table' }).click()
  await expect(page.getByText('Blocks #9')).toBeVisible()
})
