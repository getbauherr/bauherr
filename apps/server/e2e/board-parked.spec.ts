import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Own Workspace (slug `park`, Build limit 3) and own Admin (seed-e2e.ts): one parked and two working Build Tickets.
const email = 'park-admin@example.com'

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.use({ viewport: { width: 1280, height: 1200 } })

test('a parked Ticket holds no slot: the Build heading reads 2 / 3 · 1 parked and the row carries the parked badge', async ({ page }) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'park', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  const build = page.locator('.col[data-stage=build]')
  await expect(build.getByTestId('group-heading')).toContainText('2 / 3 · 1 parked')
  const parked = build.getByRole('row').filter({ hasText: 'Parked: needs cloud credentials' })
  await expect(parked.getByTestId('parked-badge')).toBeVisible()
  await expect(parked).toContainText('Parked: waiting for you')
  await expect(build.getByTestId('parked-badge')).toHaveCount(1)
})
