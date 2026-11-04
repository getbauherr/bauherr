import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test('a Ticket held by Triage asks for answers; answering them moves it to plan', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()

  const card = page.locator('.card', { hasText: 'Settle the export format' }).first()
  await expect(card.getByText('Answer questions')).toBeVisible()
  await card.getByRole('link', { name: 'Settle the export format' }).click()

  const bar = page.getByTestId('action-bar')
  await bar.getByRole('link', { name: 'Answer 1 question' }).click()
  const chat = page.getByRole('region', { name: 'Answer questions' })
  await expect(chat).toContainText('Which export format')
  await expect(page.locator('.sheet')).toHaveCount(0)
  await chat.getByRole('button', { name: 'XLSX' }).click()
  await expect(chat).toContainText('D1 XLSX. Next: the plan is being written, then you can approve it.', { timeout: 60_000 })
  await expect(bar.getByRole('link', { name: /^Answer/ })).toHaveCount(0)
  await expect(page.locator('.sheet')).toHaveCount(0)
})
