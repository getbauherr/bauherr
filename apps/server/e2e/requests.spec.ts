import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Requests list shows Draft and Linked rows with Ticket links', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.getByRole('link', { name: 'New request' }).click()
  await page.getByRole('link', { name: 'All requests' }).click()
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()
  const draft = page.locator('tbody tr').filter({ hasText: 'Export totals drift' })
  await expect(draft).toContainText('Draft')
  await expect(draft).toContainText('No Ticket yet')
  const linked = page.locator('tbody tr').filter({ hasText: 'Dark theme for the dashboard' })
  await expect(linked).toContainText('Linked')
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/requests-${scheme}-${w}x${h}.png` })
      }
    }
  }
  await linked.getByRole('link', { name: /#1/ }).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
})
