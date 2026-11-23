import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page, who = email) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const runOf = async (page: Page, title: string) => {
  await page.goto('/inbox')
  await page.getByRole('link', { name: new RegExp(title) }).first().click()
  await page.locator('main a[href^="/runs/"]').last().click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
}

const opensInNewTab = (page: Page) => page.getByRole('link', { name: /Open pull request #\d+/ })

test('a queued run says no session is connected and links to the agent keys', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Build waiting for an agent')
  await expect(page.getByText('No builder session is connected')).toBeVisible()
  await expect(page.getByRole('link', { name: 'connect one' })).toHaveAttribute('href', '/settings/api-key')
})

test('the run page links the pull request only when the ticket has one', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Result to read')
  await expect(opensInNewTab(page)).toContainText('(opens in new tab)')
  await runOf(page, 'Build that failed')
  await expect(opensInNewTab(page)).toHaveCount(0)
})

test('a failed run with a long step and handoff does not scroll sideways at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await signIn(page)
  await runOf(page, 'Build that failed')
  await expect(page.getByText('unbrokenunbroken').first()).toBeVisible()
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
})

test('a run page shows a member no cost and no dollar sign', async ({ page }) => {
  await signIn(page, 'run-member@example.com')
  await runOf(page, 'Build with reported steps')
  await expect(page.getByRole('heading', { name: 'Reported steps' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Cost/ })).toHaveCount(0)
  expect(await page.locator('main').innerText()).not.toContain('$')
})
