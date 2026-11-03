import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const login = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
}

// Own seeded Ticket (#21, one open decision D1): independent of every other spec, so shard order does not matter.
// The first answer compiles the server action under next dev (CI), hence the long timeout.
test('the owner answers the open decision with a suggestion chip and it lands in the worklog', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.locator('.card', { hasText: 'Remember the theme choice' }).first().getByRole('link', { name: 'Remember the theme choice' }).click()
  const chat = page.getByRole('region', { name: 'Answer questions' })
  await expect(chat).toContainText('Where to store the choice')
  await expect(page.locator('.sheet')).toHaveCount(0)
  await chat.getByRole('button', { name: 'Why does this matter?' }).click()
  await expect(chat).toContainText('safe default')
  await chat.getByRole('button', { name: 'a cookie' }).click()
  await expect(chat).toContainText('D1 a cookie. Next: you can approve the plan.', { timeout: 60_000 })
  await page.reload()
  await expect(page.getByText('D1 Where to store the choice: a cookie')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Answer questions' })).toHaveCount(0)
})

// Ticket #22: D2 (critical) is asked first, then D1.
test('a free-text answer is recorded and a reload resumes at the next question', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.locator('.card', { hasText: 'Pick the export columns' }).first().getByRole('link', { name: 'Pick the export columns' }).click()
  const chat = page.getByRole('region', { name: 'Answer questions' })
  await expect(chat).toContainText('Follow the system setting')
  await chat.getByRole('textbox', { name: 'Your answer' }).fill('only on mobile')
  await chat.getByRole('button', { name: 'Send' }).click()
  await expect(chat.getByRole('button', { name: 'a cookie' })).toBeVisible({ timeout: 60_000 })
  await expect(chat).toContainText('1 open')
  await page.reload()
  const resumed = page.getByRole('region', { name: 'Answer questions' })
  await expect(resumed).toContainText('Where to store the choice')
  await expect(resumed).toContainText('D2: only on mobile')
  await expect(resumed).toContainText('1 open')
  await resumed.getByRole('button', { name: 'localStorage' }).click()
  await expect(resumed).toContainText('D2 only on mobile · D1 localStorage. Next: you can approve the plan.', { timeout: 60_000 })
})
