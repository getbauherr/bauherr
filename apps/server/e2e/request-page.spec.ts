import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test('a Sent request opens its page with Tickets, plain status and a merged comment list', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()

  await page.goto('/requests')
  await page.locator('tbody tr').filter({ hasText: 'Invoice filter and CSV export' }).getByRole('link', { name: 'Invoice filter and CSV export' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Invoice filter and CSV export' })).toBeVisible()
  const tickets = page.getByTestId('request-ticket')
  await expect(tickets).toHaveCount(2)
  await expect(tickets.first()).toContainText('Ship the CSV export')
  await expect(tickets.first()).toContainText(/Being (looked at|planned|built|reviewed)|On staging|Done/)

  await page.getByLabel('Comment on').selectOption({ label: '#7 Ship the invoice filter' })
  await page.getByRole('textbox', { name: 'Comment' }).fill('Looks right to me')
  await page.getByRole('button', { name: 'Post comment' }).click()
  await expect(page.getByText('Posted to the forge.')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('request-comment').filter({ hasText: 'Looks right to me' }).last()).toContainText('#7')

  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/request-page-${scheme}-${w}x${h}.png`, fullPage: true })
      }
    }
  }
})

test('a request of another id is a 404', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
  expect((await page.goto('/requests/999999'))?.status()).toBe(404)
})
