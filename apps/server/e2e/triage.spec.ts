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

  // The Ticket waits for answers: the conversation is the left pane, the action bar sits in the Now pane.
  const panel = page.getByTestId('split-conversation').getByTestId('refine-panel')
  await expect(panel).toContainText('Which export format')
  await expect(page.getByTestId('now-pane').getByTestId('action-bar')).toHaveCount(1)
  await expect(page.getByTestId('chat-dock')).toBeHidden()
  await panel.getByRole('button', { name: /XLSX/ }).click()
  await page.getByTestId('artifact-bar').click() // embedded in the Ticket page, the refined Ticket opens as a sheet from the bar
  const send = page.getByTestId('send-to-planning')
  await expect(send).toBeEnabled({ timeout: 30_000 })
  await send.click()
  await expect(panel).toHaveAttribute('data-state', 'sent')
})
