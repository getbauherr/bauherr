import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// Read-only: no key is created and no price refresh is started (that would call the internet).

const signIn = async (page: Page, who = email) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('AI usage: Measure session cost shows the status, fills in per tool and never shows a key', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/usage')
  const section = page.getByRole('region', { name: 'Measure session cost' })
  await expect(section.getByRole('heading', { name: 'Measure session cost' })).toBeVisible()
  await expect(section.getByTestId('gateway-status')).toContainText('Gateway not reachable')
  await expect(section.getByRole('button', { name: 'Open the gateway UI' })).toHaveCount(0)
  const setup = section.getByTestId('harness-setup')
  await expect(setup.locator('pre').first()).toContainText(/BAUHERR_SESSION=orchestrator-[0-9a-f]{4}/)
  await setup.getByLabel('Role of the session').selectOption({ label: 'Reviewer' })
  await expect(setup.locator('pre').first()).toContainText(/BAUHERR_SESSION=reviewer-[0-9a-f]{4}/)
  await expect(setup).toContainText('ANTHROPIC_CUSTOM_HEADERS')
  await setup.getByLabel('Pay with').selectOption('api-key')
  await expect(setup).toContainText('ANTHROPIC_AUTH_TOKEN="$BAUHERR_GATEWAY_KEY"')
  await setup.getByLabel('Coding tool').selectOption('cursor')
  await expect(page.getByTestId('harness-level')).toContainText('Not measurable through the gateway')
  await setup.getByLabel('Coding tool').selectOption('gemini-cli')
  await expect(page.getByTestId('harness-level')).toContainText('Measured per key only')
  await expect(setup).toContainText('GOOGLE_GEMINI_BASE_URL')
  await expect(setup).not.toContainText(/sk-bauherr|bha_/)
  if (process.env.SHOTS_DIR) await setup.getByLabel('Coding tool').selectOption('claude-code')
  if (process.env.SHOTS_DIR) await section.screenshot({ path: `${process.env.SHOTS_DIR}/measure-session-cost-${page.viewportSize()!.width}.png` })
})

test('Models & budget: the price status says when prices were updated or that none were fetched, and offers Update now', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/models')
  const prices = page.getByTestId('prices-status')
  await expect(prices.getByRole('heading', { name: 'Prices and models' })).toBeVisible()
  await expect(prices).toContainText(/Prices updated .* from .*, [\d,]+ models|Prices have not been fetched yet/)
  await expect(prices.getByRole('button', { name: 'Update now' })).toBeVisible()
  await expect(page.getByTestId('gateway-status')).toBeVisible()
  if (process.env.SHOTS_DIR) await prices.screenshot({ path: `${process.env.SHOTS_DIR}/prices-status-${page.viewportSize()!.width}.png` })
})

test('a non-Admin sees no session-key button and no gateway UI button', async ({ page }) => {
  await signIn(page, 'member@example.com')
  await page.goto('/settings/usage')
  await expect(page.getByRole('button', { name: 'Create a session key' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open the gateway UI' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Measure session cost' })).toBeVisible()
})
