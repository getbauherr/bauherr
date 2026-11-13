import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const login = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('the hotfix switch is visible with its sentence and saves right away (Admin)', async ({ page }) => {
  // Flips a Workspace switch no other spec reads and puts it back.
  await login(page, email)
  await page.goto('/workflow/edit')
  await expect(page.getByRole('heading', { name: 'Workflow', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText('A hotfix pauses one running session of its role.')).toBeVisible()
  const pause = page.getByRole('switch', { name: 'Pause running work for a hotfix' })
  const was = await pause.isChecked()
  expect(was).toBe(true)
  await pause.click()
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  await page.reload()
  expect(await page.getByRole('switch', { name: 'Pause running work for a hotfix' }).isChecked()).toBe(!was)
  await page.getByRole('switch', { name: 'Pause running work for a hotfix' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  await page.reload()
  expect(await page.getByRole('switch', { name: 'Pause running work for a hotfix' }).isChecked()).toBe(was)
})

test('a paused Ticket reads "Paused for hotfix" on its Board card and Ticket page', async ({ page }) => {
  await login(page, email)
  await page.goto('/')
  const title = 'Paused for a hotfix: export totals'
  const card = page.locator('.card', { hasText: title }).first()
  await expect(card).toContainText('Paused for hotfix #7')
  await card.getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
  await expect(page.getByTestId('ticket-status')).toContainText('Paused for hotfix #7')
})
