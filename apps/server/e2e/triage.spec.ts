import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

test('a Ticket held by Triage asks for answers; answering them moves it to plan', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()

  const card = page.locator('.card', { hasText: 'Settle the export format' }).first()
  await expect(card.getByText('Answer questions')).toBeVisible()
  await card.getByRole('link', { name: 'Settle the export format' }).click()

  const bar = page.getByTestId('action-bar')
  await bar.getByRole('link', { name: 'Answer 1 question' }).click()
  const panel = page.getByTestId('refine-panel')
  await expect(panel).toContainText('Which export format')
  await expect(page.getByTestId('chat-dock')).toBeHidden()
  await panel.getByRole('button', { name: /XLSX/ }).click()
  await expect(panel.getByTestId('refine-summary')).toBeVisible({ timeout: 30_000 })
  await panel.getByRole('button', { name: 'Send to planning' }).click()
  await expect(panel).toHaveAttribute('data-state', 'sent')
  await expect(bar.getByRole('link', { name: /^Answer/ })).toHaveCount(0)
})
