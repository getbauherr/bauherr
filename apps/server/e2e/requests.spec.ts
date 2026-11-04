import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Requests list shows Draft and Sent rows with plain wording and Ticket links', async ({ page }) => {
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
  await expect(draft).not.toContainText('Ticket')
  const linked = page.locator('tbody tr').filter({ hasText: 'Dark theme for the dashboard' })
  await expect(linked).toContainText('Sent')
  await expect(page.locator('tbody')).not.toContainText(/Linked|Triage|↳|No Ticket yet/)
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

test('New request hides the Product select for a single-Product Workspace', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('solo@example.com')
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
  await page.goto('/requests/new')
  await expect(page.getByLabel('Describe your request')).toBeVisible()
  await expect(page.getByLabel('Product')).toHaveCount(0)
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/new-request-single-product-${scheme}-${w}x${h}.png` })
      }
    }
  }
})
