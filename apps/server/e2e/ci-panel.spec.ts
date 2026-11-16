import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

/** Ticket #581 of Acme CI: one check running, one failed, a Run in Build. */
test('Ticket and Run page show Waiting for CI 1/2, both checks and the pull request link', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()

  await page.goto('/tickets/n/581')
  const status = page.getByTestId('ticket-status')
  await expect(status).toContainText('Waiting for CI 1/2')
  await expect(status).toContainText('0 of 2 checks passed, 1 running. The agent resumes when they finish.')
  await expect(page.getByTestId('ticket-status')).not.toContainText(/building|working/i)
  const rows = page.getByTestId('ci-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'test' })).toContainText('Running')
  await expect(rows.filter({ hasText: 'lint' })).toContainText('Failed')
  await expect(page.getByTestId('ci-panel').locator('time')).toContainText(/^Updated /)
  const link = page.getByTestId('action-bar').getByRole('link', { name: /^Open pull request #88 on GitHub/ })
  await expect(link).toHaveAttribute('href', 'https://github.com/acme/ci/pull/88')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toContainText('(opens in new tab)')
  await expect(page.getByTestId('action-bar')).not.toContainText(/working on this/i)

  await page.getByRole('link', { name: /^Run #\d+$/ }).first().click()
  await expect(page.getByText('Waiting for CI 1/2')).toBeVisible()
  await expect(page.getByTestId('ci-row')).toHaveCount(2)
  await expect(page.getByRole('link', { name: /^Open pull request #88 on GitHub/ })).toBeVisible()
})
