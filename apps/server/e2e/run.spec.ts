import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Run page: graph, timeline, list, details, re-run', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Runs' }).click()
  const rows = page.locator('table tbody tr')
  await rows.filter({ hasText: 'Succeeded' }).filter({ hasText: 'build' }).getByRole('link', { name: /^#\d+$/ }).first().click()

  await expect(page.locator('.rnode')).toHaveCount(6)
  await expect(page.locator('.rnode[aria-current]')).toHaveAttribute('data-stage', 'build')
  await page.getByRole('navigation', { name: 'Run view' }).getByRole('link', { name: 'Timeline' }).click()
  await expect(page.locator('.gstep > .track:not(.sub) .bar')).toHaveCount(3)
  await page.getByRole('navigation', { name: 'Run view' }).getByRole('link', { name: 'List' }).click()
  await page.locator('details.calls summary', { hasText: '1' }).first().click()
  await expect(page.locator('details.calls[open]')).toContainText('Edit')
  const panel = page.getByLabel('Details')
  await expect(panel).toContainText('Duration')
  await expect(panel).toContainText('Succeeded')
  await expect(panel.getByRole('button', { name: 'Re-run stage' })).toHaveCount(0)

  await page.goto('/?view=runs')
  await rows.filter({ hasText: 'Needs human' }).getByRole('link', { name: /^#\d+$/ }).first().click()
  await page.getByRole('button', { name: 'Re-run stage' }).click()
  await page.getByRole('button', { name: /Confirm re-run/ }).click()
  await expect(page.getByText('A Run is already active for this stage').or(page.getByLabel('Details').getByText(/^(Queued|Needs human)$/))).toBeVisible()
})
