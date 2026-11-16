import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// Read-only: the seeded sessions of team.spec.ts (ses_e2e_working holds a Run on #128, ses_e2e_offline is disconnected).

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('an agent opens from the Team page with its sections, and Back returns to the list', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  await page.getByRole('link', { name: 'orchestrator-1@laptop' }).click()
  await expect(page).toHaveURL(/\/team\/ses_e2e_working$/)
  await expect(page.getByTestId('agent-name')).toContainText('orchestrator-1@laptop')
  await expect(page.getByTestId('agent-identity')).toContainText('claude-code 2.1.0 · claude-sonnet-4-5 · anthropic')
  await expect(page.getByTestId('agent-status')).toContainText(/Working|Stuck/)
  for (const name of ['Current Run', 'Cost', 'Milestones', 'Runs']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
  await expect(page.getByTestId('current-run')).toContainText('#128')
  await expect(page.getByTestId('agent-details')).toContainText('Details')
  await page.getByTestId('disconnect').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Disconnect this agent')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('link', { name: 'Agent team', exact: true }).first().click()
  await expect(page).toHaveURL(/\/team$/)
})

test('a disconnected agent says why and offers no Disconnect', async ({ page }) => {
  await signIn(page)
  await page.goto('/team/ses_e2e_offline')
  await expect(page.getByTestId('agent-status')).toContainText('Disconnected: The agent ended the session.')
  await expect(page.getByTestId('disconnect')).toHaveCount(0)
})

test('an unknown id says so with a link back', async ({ page }) => {
  await signIn(page)
  await page.goto('/team/ses_does_not_exist')
  await expect(page.getByText('This agent does not exist.')).toBeVisible()
  await page.getByRole('link', { name: 'Agent team' }).first().click()
  await expect(page).toHaveURL(/\/team$/)
})

test('/team#ses_<id> redirects to the agent page', async ({ page }) => {
  await signIn(page)
  await page.goto('/team#ses_e2e_working')
  await expect(page).toHaveURL(/\/team\/ses_e2e_working$/)
  await expect(page.getByTestId('agent-name')).toBeVisible()
})
