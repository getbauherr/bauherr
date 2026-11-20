import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test(
  'Models & budget: the price status says when prices were updated or ' +
    'that none were fetched, and offers Update now',
  async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('banner')).toBeVisible()
    await page.goto('/settings/models')
    const prices = page.getByTestId('prices-status')
    await expect(prices.getByRole('heading', { name: 'Prices and models' })).toBeVisible()
    await expect(prices).toContainText(/Prices updated .* from .*, [\d,]+ models|Prices have not been fetched yet/)
    await expect(prices.getByRole('button', { name: 'Update now' })).toBeVisible()
    await expect(page.getByTestId('gateway-status')).toBeVisible()
    if (process.env.SHOTS_DIR)
      await prices.screenshot({ path: `${process.env.SHOTS_DIR}/prices-status-${page.viewportSize()!.width}.png` })
  },
)
