import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const shots = process.env.SHOTS_DIR

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Review Run page shows the verdict and findings; Product settings have the auto-merge toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/runs')
  await page.locator('table tbody tr').filter({ hasText: 'Upgrade the payment SDK' }).getByRole('link', { name: /^#\d+$/ }).first().click()

  const review = page.getByLabel('Review', { exact: true })
  await expect(review).toContainText('Changes requested')
  await expect(review.getByLabel('Findings').locator('li')).toHaveCount(2)
  await expect(review).toContainText('src/payment.ts:42')
  await expect(review).toContainText('Scenario: when the gateway answers 402')
  if (shots) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.screenshot({ path: `${shots}/run-review-${scheme}-1280x800.png` })
    }
  }

  await page.goto('/settings/products')
  await expect(page.getByLabel('Auto-merge').first()).toBeChecked()
})
