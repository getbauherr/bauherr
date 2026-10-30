import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test('answer the critical decision, then approve the plan', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'View' })).toBeVisible()
  await page.goto('/?view=list')

  const row = page.locator('ul.list li', { hasText: 'Add a dark theme to the dashboard' }).first()
  await expect(row.getByText('Answer decisions')).toBeVisible()
  await row.getByRole('link', { name: 'Add a dark theme to the dashboard' }).click()

  await expect(page.locator('.sheet tbody tr')).toHaveCount(2)
  await expect(page.getByText('★ critical')).toHaveCount(1)
  const approve = page.getByRole('button', { name: 'Approve plan' })
  await expect(approve).toBeDisabled()

  await page.getByRole('radio', { name: 'yes, until the user picks' }).check()
  await page.getByRole('button', { name: 'Save answers' }).click()
  await expect(approve).toBeEnabled()
  await expect(page.locator('#worklog')).toBeVisible()
  await expect(page.getByText('D2 Follow the system setting: yes, until the user picks')).toBeVisible()

  await approve.click()
  await expect(page.getByText('✓ Plan approved')).toBeVisible()
  await expect(approve).toHaveCount(0)
})
