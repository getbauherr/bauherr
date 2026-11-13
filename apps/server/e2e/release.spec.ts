import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
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
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
})

const open = async (page: import('@playwright/test').Page, title: string) => {
  const row = page.locator('.card', { hasText: title }).first()
  await expect(row.getByText('Accept on staging')).toBeVisible()
  await row.getByRole('link', { name: title }).click()
}

test('accept on staging moves the Ticket to done', async ({ page }) => {
  await open(page, 'Ship the CSV export')
  const bar = page.getByTestId('action-bar')
  await expect(page.getByText('CSV export for invoices.')).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Open staging' })).toHaveAttribute('href', 'https://staging.example.com')
  await expect(page.getByRole('link', { name: 'Open staging' })).toHaveCount(1)
  await expect(page.getByLabel('What needs to change')).toBeHidden()
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByText('Accepted on staging')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(page.getByTestId('stage-strip').locator('[aria-current=step]')).toContainText(/done/i)
})

test('a production-gated Ticket waits for an explicit production approval', async ({ page }) => {
  await open(page, 'Ship the gated export')
  await expect(page.getByRole('button', { name: 'Approve production' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByTestId('action-bar')).toContainText('Approve the production deploy.')
  await expect(page.getByTestId('stage-strip').locator('[aria-current=step]')).toContainText('Staging')
  await page.getByRole('button', { name: 'Approve production' }).click()
  await expect(page.getByText('Accepted on staging · Approved for production')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve production' })).toHaveCount(0)
})

test('request changes sends the Ticket back to build', async ({ page }) => {
  await open(page, 'Ship the invoice filter')
  await page.getByTestId('action-bar').getByRole('link', { name: 'Request changes' }).click()
  await page.getByLabel('What needs to change').fill('The filter ignores the date range')
  await page.getByRole('button', { name: 'Request changes' }).click()
  await expect(page.getByTestId('stage-strip').locator('[aria-current=step]')).toContainText(/build/i)
  await expect(page.getByRole('button', { name: 'Accept on staging' })).toHaveCount(0)
})

test('Details shows the merge commit to an Admin only', async ({ page }) => {
  await open(page, 'Ship the export header')
  await page.getByText('About', { exact: true }).click()
  await expect(page.getByText('abc1234def')).toBeVisible()
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill('member@example.com')
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
  await open(page, 'Ship the export header')
  await page.getByTestId('pane-tab-history').click()
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await expect(page.getByTestId('now-pane')).not.toContainText(/abc1234|Merge commit/)
})

test('dependencies are visible on cards and the Ticket page', async ({ page }) => {
  const row = page.locator('.card', { hasText: 'Blocked: add the invoice filter' }).first()
  await expect(row.locator('[data-status=blocked]')).toHaveText('Blocked')
  await expect(row.getByTestId('status-detail')).toHaveText('by #8')
  await row.getByRole('link', { name: 'Blocked: add the invoice filter' }).click()
  await expect(page.getByText('Blocked by #8 Blocker: migrate the invoice table')).toBeVisible()
  await page.getByRole('link', { name: '#8 Blocker: migrate the invoice table' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('#8')
  await expect(page.getByText('Blocks #9')).toBeVisible()
})
