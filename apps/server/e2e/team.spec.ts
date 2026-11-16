import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// Read-only: the test that saves a role lives in workflow-editor.spec.ts (both write the Workspace's factory file, so they share one worker). Seeded in scripts/seed-e2e.ts: an orchestrator session working on #128, an idle reviewer, a disconnected engineer.

const signIn = async (page: Page, who = email) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const keyed = 'team-key@example.com'
const connect = (page: Page) => page.getByTestId('connect-panel')
const role = (page: Page) => connect(page).getByLabel('Role')

test('Agent team is in the sidebar after Workflow, not in Settings; /team lists summary, Connect, Sessions, Roles in that order', async ({ page }) => {
  await signIn(page)
  const links = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()
  const at = (name: string) => links.findIndex((l) => l.startsWith(name))
  expect(at('Agent team')).toBe(at('Workflow') + 1)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Agent team/ }).click()
  await expect(page.getByRole('heading', { name: 'Agent team', level: 1 })).toBeVisible()
  await expect(page.getByTestId('team-summary')).toHaveText(/^1 working · 1 idle( · \d+ roles? needs? an agent)?$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Connect a session', 'Sessions', 'Roles'])
  await expect(page.getByRole('radiogroup', { name: 'Roles' })).toHaveCount(0)
  await expect(page.getByText('No session connected', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('connect')).toHaveCount(0)
  await expect(page.locator('main button[data-variant=default]')).toHaveCount(1) // Copy prompt is the one accent button
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toHaveAttribute('data-variant', 'default')
})

test('the role defaults to the one with waiting work and no agent, and the hint says so', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team')
  const first = page.getByTestId('needs-agent-row').first()
  await expect(first).toContainText(/\d+ tickets? waiting/)
  await expect(role(page)).toHaveValue((await first.getAttribute('data-role'))!)
  await expect(page.getByTestId('connect-hint')).toHaveText(/^Default: \d+ tickets? waiting, no agent$/)
  await expect(page.locator('details', { hasText: 'First-time setup' })).not.toHaveAttribute('open', '') // a key and a session exist
})

test('one click on Copy prompt copies the prompt for the chosen role and the choice is remembered', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    if (navigator.clipboard) return // a secure context (localhost) has the real one; a dev server reached by another host name gets a stand-in
    let text = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (text = t), readText: async () => text } })
  })
  await signIn(page, keyed)
  await page.goto('/team')
  const prompt = /^Connect to the factory as (\w+)( with session "[a-z0-9-]+")? and work until I tell you to stop\.$/
  await expect(page.getByTestId('connect-prompt')).toHaveText(prompt)
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.getByTestId('connect-prompt').innerText())
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeVisible({ timeout: 3000 }) // "Copied" lasts 1.5 s
  await role(page).selectOption('security')
  await expect(page.getByTestId('connect-prompt')).toContainText('as security')
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('as security')
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('bauherr-team-role:')).map(([, v]) => v))).toEqual(['security'])
})

test('without an agent key Copy prompt is disabled, says why and First-time setup is open', async ({ page }) => {
  await signIn(page, 'member@example.com') // the keyless user: the Admin gets a key from the setup and settings specs
  await page.goto('/team')
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeDisabled()
  await expect(connect(page).getByText('Create an agent key first.')).toBeVisible()
  await expect(page.locator('details', { hasText: 'First-time setup' })).toHaveAttribute('open', '')
  await expect(connect(page).getByRole('link', { name: 'Create an agent key' })).toHaveAttribute('href', '/settings/api-key')
})

test('/team?role= preselects the role; Connect on a needs-an-agent row selects it and focuses the select', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team?role=ux')
  await expect(role(page)).toHaveValue('ux')
  await expect(page.getByTestId('connect-prompt')).toContainText('as ux')
  await page.goto('/team')
  await page.getByTestId('needs-agent-row').first().getByRole('button', { name: 'Connect' }).click()
  await expect(role(page)).toBeFocused()
  await expect(role(page)).toHaveValue((await page.getByTestId('needs-agent-row').first().getAttribute('data-role'))!)
})

test('the role, the disclosure and the toggle survive a refresh', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team')
  await expect(async () => {
    await role(page).selectOption('test')
    await expect(role(page)).toHaveValue('test', { timeout: 1000 })
  }).toPass()
  await page.locator('summary', { hasText: 'First-time setup' }).click()
  await page.getByRole('switch').check()
  const refreshed = page.waitForResponse((r) => r.request().headers().rsc === '1')
  await page.evaluate(() => (window as unknown as { next: { router: { refresh: () => void } } }).next.router.refresh()) // what the 5 s poll does when something changed
  await refreshed
  await expect(role(page)).toHaveValue('test')
  await expect(page.locator('details', { hasText: 'First-time setup' })).toHaveAttribute('open', '')
  await expect(page.getByRole('switch')).toBeChecked()
})

test('session rows say who is working on which ticket, who is idle; the disconnected one is behind "Show 1 disconnected"', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  const row = (id: string) => page.locator(`#${id}`)
  await expect(row('ses_e2e_working')).toContainText('orchestrator-1@laptop')
  await expect(row('ses_e2e_working')).toContainText('Triaging')
  await expect(row('ses_e2e_working').getByRole('link', { name: /#128 Team: triage in a session/ })).toHaveAttribute('href', '/tickets/n/128')
  await expect(row('ses_e2e_idle')).toContainText('Idle')
  await expect(row('ses_e2e_idle')).toContainText('reviewer-1@laptop')
  await expect(row('ses_e2e_idle')).toContainText('No ticket')
  const rows = await page.getByTestId('sessions-list').locator('[data-testid=session-row]').evaluateAll((els) => els.map((e) => e.id))
  expect(rows.indexOf('ses_e2e_working')).toBeLessThan(rows.indexOf('ses_e2e_idle')) // working before idle
  await expect(row('ses_e2e_offline')).toHaveCount(0)
  await page.getByLabel('Show 1 disconnected').check()
  await expect(row('ses_e2e_offline')).toContainText('Disconnected')
  await expect(row('ses_e2e_offline')).toContainText(/\d+ min ago/)
  await expect(page.getByLabel('Hide disconnected')).toBeChecked()
})

test('sessions show their cost today, every Bauherr sees it', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working').getByTestId('session-cost')).toHaveText('$0.400')
  await page.context().clearCookies()
  await signIn(page, 'member@example.com')
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working').getByTestId('session-cost')).toHaveText('$0.400')
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

test('a member sees the Agent team page but cannot change a role', async ({ page }) => {
  await signIn(page, 'member@example.com')
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Agent team', level: 1 })).toBeVisible()
  await page.locator('[data-testid=role-details][data-role=engineer] summary').click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(page.locator('[data-testid=role-details][data-role=engineer]').getByText('Only the owner can change a role.')).toBeVisible()
})

test('the header pill and the sidebar dot show who is working on every page; Settings does not list the Agent team', async ({ page }) => {
  await signIn(page)
  for (const path of ['/', '/inbox']) {
    await page.goto(path)
    await expect(page.getByTestId('presence-pill')).toHaveText(/^[1-9]\d* working · 1 idle$/)
    await expect(page.getByTestId('presence-dot')).toHaveAttribute('aria-label', /^[1-9]\d* working, 1 idle$/)
  }
  await page.getByTestId('presence-pill').click()
  await expect(page).toHaveURL(/\/team$/)
  await expect(page.getByRole('heading', { name: 'Agent team', level: 1 })).toBeVisible()
  await page.goto('/settings/profile')
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Team' })).toHaveCount(0)
})
