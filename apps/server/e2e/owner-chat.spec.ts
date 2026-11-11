import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE, 'needs the server started with CHAT_FAKE=1 (set CHAT_FAKE=1 here)')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const login = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
}

const dock = (page: Page) => page.getByTestId('chat-dock')
const questions = (page: Page) => dock(page).getByRole('region', { name: 'Answer questions' })
const composer = (page: Page) => dock(page).getByRole('textbox', { name: 'Message the factory' })

// Own seeded Ticket (#21, one open decision D1): independent of every other spec, so shard order does not matter.
test('the owner answers the open decision in the docked chat and it lands in the worklog', async ({ page }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Remember the theme choice' }).first().getByRole('link', { name: 'Remember the theme choice' }).click()
  await page.getByTestId('action-bar').getByRole('button', { name: /^Answer \d questions?$/ }).click()
  const card = questions(page)
  await expect(card).toContainText('Where to store the choice')
  await expect(card).toContainText('Question 1 of 1')
  await expect(card.locator('[data-slot=button][data-variant=default]')).toHaveCount(1)
  await expect(card.locator('[data-slot=button][data-variant=default]')).toContainText('(recommended)')
  await expect(page.locator('.sheet')).toHaveCount(0)
  await card.getByRole('button', { name: 'Why does this matter?' }).click()
  await expect(dock(page).locator('[data-role=assistant]').last()).toContainText('[fake] you said: Why does this matter?', { timeout: 30_000 })
  await composer(page).fill('/answer what is a cookie?')
  await composer(page).press('Enter')
  await expect(card.getByRole('button', { name: 'Use my text as the answer' })).toBeVisible({ timeout: 60_000 })
  await card.getByRole('button', { name: 'a cookie', exact: true }).click()
  await expect(card).toContainText('D1 a cookie. Next: the plan is being written, then you can approve it.', { timeout: 60_000 })
  await page.reload()
  await page.getByText('Details', { exact: true }).click()
  await expect(page.getByText('D1 Where to store the choice: a cookie')).toBeVisible()
  await expect(questions(page)).toHaveCount(0)
  await expect(page.getByTestId('action-bar').getByRole('button', { name: /^Answer \d/ })).toHaveCount(0)
})

// Ticket #22: D2 (critical) is asked first, then D1.
test('a free-text answer is recorded and a reload resumes at the next question', async ({ page }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Pick the export columns' }).first().getByRole('link', { name: 'Pick the export columns' }).click()
  await page.getByTestId('action-bar').getByRole('button', { name: /^Answer \d questions?$/ }).click()
  const card = questions(page)
  await expect(card).toContainText('Follow the system setting')
  await composer(page).fill('/answer only on mobile')
  await composer(page).press('Enter')
  await expect(card.getByRole('button', { name: /^a cookie/ })).toBeVisible({ timeout: 60_000 })
  await expect(card).toContainText('1 open')
  await page.reload()
  await expect(questions(page)).toContainText('Where to store the choice')
  await expect(questions(page)).toContainText('1 open')
  await questions(page).getByRole('button', { name: 'localStorage' }).click()
  await expect(questions(page)).toContainText('D2 only on mobile · D1 localStorage. Next: the plan is being written, then you can approve it.', { timeout: 60_000 })
})
