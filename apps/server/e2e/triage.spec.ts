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

  const card = page.locator('.card', { hasText: 'Clarify the export scope' }).first()
  await expect(card.getByText('Answer questions')).toBeVisible()
  await card.getByRole('link', { name: 'Clarify the export scope' }).click()

  await expect(page.locator('.sheet tbody tr')).toHaveCount(1)
  await page.getByRole('radio', { name: 'XLSX' }).check()
  await page.getByRole('button', { name: 'Save answers' }).click()
  await expect(page.getByText('D1 Which export format: XLSX')).toBeVisible()
  await expect(page.getByText('Answer questions')).toHaveCount(0)
})
