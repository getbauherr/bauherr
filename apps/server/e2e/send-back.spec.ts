import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test('a Bauherr sends a Ticket back from Build to Plan and it stays there', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()

  await page.locator('.card', { hasText: 'Send back from build: export footer' }).first().getByRole('link', { name: 'Send back from build: export footer' }).click()
  const strip = page.getByTestId('stage-strip').locator('[aria-current=step]')
  await expect(strip).toContainText(/build/i)

  await page.getByTestId('ticket-send-back').getByTestId('send-back').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Send back to').selectOption('to:plan')
  await dialog.getByLabel('Why (optional)').fill('The plan misses the footer layout')
  await dialog.getByRole('button', { name: 'Send back', exact: true }).click()

  await expect(strip).toContainText(/plan/i)
  await expect(page.getByText('Sent back to Plan by').first()).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('stage-strip').locator('[aria-current=step]')).toContainText(/plan/i)
  await expect(page.getByText('Sent back to Plan by').first()).toBeVisible()
})
