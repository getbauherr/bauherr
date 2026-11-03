import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

// Own seeded Ticket (#21, one open decision D1): independent of every other spec, so shard order does not matter.
// The first answer compiles the server action under next dev (CI), hence the long timeout.
test('the owner answers the open decision interactively and it lands in the sheet', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
  await page.locator('.card', { hasText: 'Remember the theme choice' }).first().getByRole('link', { name: 'Remember the theme choice' }).click()

  await page.getByRole('button', { name: 'Answer interactively' }).click()
  const chat = page.getByRole('region', { name: 'Answer interactively' })
  await expect(chat).toContainText('Where to store the choice')
  await chat.getByRole('button', { name: 'a cookie' }).click()
  await expect(chat).toContainText('All questions answered', { timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Answer interactively' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('radio', { name: 'a cookie' })).toBeChecked()
})
