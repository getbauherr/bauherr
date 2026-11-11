import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// Read-only: the test that saves a role lives in factory-file.spec.ts (both write the Workspace's factory file, so they share one worker). Seeded in scripts/seed-e2e.ts: an orchestrator session working on #128, an idle reviewer, a disconnected engineer.

const signIn = async (page: Page, who = email) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Team is in the sidebar after Workflow; the roster is a keyboard-operable radiogroup with the role sheet', async ({ page }) => {
  await signIn(page)
  const links = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()
  expect(links.indexOf('Team')).toBe(links.indexOf('Workflow') + 1)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }).click()
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible()
  await expect(page.getByTestId('team-summary')).toHaveText(/\d+ roles · 2 sessions connected · 1 working/)

  const roster = page.getByRole('radiogroup', { name: 'Roles' })
  const radios = roster.getByRole('radio')
  await radios.first().focus()
  await expect(radios.first()).toBeChecked()
  await page.keyboard.press('ArrowDown')
  await expect(radios.nth(1)).toBeChecked()
  await expect(radios.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(radios.last()).toBeChecked()
  await page.keyboard.press('Home')
  await expect(radios.first()).toBeChecked()

  await roster.locator('[data-role=engineer]').click()
  const sheet = page.getByRole('region', { name: 'Software engineer' })
  await expect(sheet.locator('#role-title')).toHaveText('Software engineer')
  await expect(sheet.getByRole('list', { name: 'Skills' })).toContainText('TypeScript')
  await expect(sheet.getByText('Works on')).toBeVisible()
  await expect(sheet.getByTestId('connect')).toContainText('Connect to the factory as engineer and work until I tell you to stop.')
  await expect(sheet.getByRole('link', { name: 'How sessions connect' })).toHaveAttribute('href', /session-mode\.md/)
})

test('session rows say who is working on which ticket, who is idle and who is gone', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  const row = (id: string) => page.locator(`#${id}`)
  await expect(row('ses_e2e_working')).toContainText('Working')
  await expect(row('ses_e2e_working')).toContainText('orchestrator-1@laptop')
  await expect(row('ses_e2e_working').getByRole('link', { name: /#128 Team: triage in a session/ })).toHaveAttribute('href', '/tickets/n/128')
  await expect(row('ses_e2e_idle')).toContainText('Idle')
  await expect(row('ses_e2e_idle')).toContainText('reviewer-1@laptop')
  await expect(row('ses_e2e_offline')).toContainText('Offline')
  await expect(row('ses_e2e_offline')).toContainText(/last seen \d+ min ago/)
})

test('sessions and roles show their cost next to the active time', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working').getByTestId('session-cost')).toContainText(/\$0\.400 30 d/)
  await expect(page.locator('#sessions-reviewer').getByTestId('role-cost')).toContainText(/· \$2\.50 30 d/)
  await expect(page.locator('#sessions-engineer').getByTestId('role-cost')).toContainText(/· \$0\.400 30 d/)
})

test('the Workflow graph shows the agents stationed at a stage', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await expect(page.locator('[data-testid=stage-node][data-stage=triage] [data-testid=stage-agent]')).toContainText('1 working')
  await expect(page.locator('[data-testid=stage-node][data-stage=review] [data-testid=stage-agent]')).toContainText('1 idle')
})

test('Insights lists the sessions with their active time', async ({ page }) => {
  await signIn(page)
  await page.goto('/insights')
  await expect(page.getByRole('heading', { name: 'Team', level: 2 })).toBeVisible()
  await expect(page.getByTestId('team-sessions')).toContainText('orchestrator-1@laptop')
})

test('a member sees the Team page but cannot change a role', async ({ page }) => {
  await signIn(page, 'member@example.com')
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Roles' }).locator('[data-role=engineer]').click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(page.getByText('Only the owner can change a role.')).toBeVisible()
})
