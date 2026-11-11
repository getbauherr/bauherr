import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const shots = process.env.SHOTS_DIR
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')
test.describe.configure({ mode: 'serial' })

/** Only this file touches the Workspace `newco` (no Product, no factory file in the seed): the wizard walks it from nothing. */
const signIn = async (page: Page, as = email) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'newco', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(as)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const shoot = async (page: Page, name: string, sizes: [number, number][] = [[1280, 800]]) => {
  if (!shots) return
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.screenshot({ path: `${shots}/${name}-${scheme}-${w}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.emulateMedia({ colorScheme: null })
}
const step = (page: Page, name: string) => expect(page.getByRole('heading', { name, level: 2 })).toBeVisible()
const rail = (page: Page, label: string) => page.getByRole('list', { name: 'Setup' }).getByRole('listitem').filter({ hasText: label })
const chip = (page: Page) => page.getByRole('link', { name: /^Setup \d\/5/ })

test('a Member who is not Admin is asked to get an Admin', async ({ page }) => {
  await signIn(page, 'setup-member@example.com')
  await page.goto('/setup')
  await expect(page.getByText('Ask an Admin to finish setup.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(chip(page)).toHaveCount(0)
})

test('an Admin of a Workspace without a Product is sent from / to the wizard', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await step(page, 'Connect your forge')
  await expect(chip(page)).toContainText('Setup 0/5')
  for (const l of ['Connect your forge', 'Pick a product', 'Pick your team', 'Connect a session', 'First request']) await expect(rail(page, l)).toBeVisible()
  await expect(rail(page, 'Connect your forge')).toContainText('To do')
  await expect(rail(page, 'Pick your team')).toContainText('Optional')
  await page.goto('/requests/new')
  await expect(page.getByRole('link', { name: 'Set up your Workspace' })).toBeVisible()
})

test('the five steps end to end: forge, repository, Careful team, agent key, an open issue, finish', async ({ page }) => {
  await signIn(page)
  await page.goto('/setup')

  // 1 Connect your forge
  await step(page, 'Connect your forge')
  await shoot(page, 'wizard/1-forge')
  await page.getByLabel('Name', { exact: true }).fill('GitHub Newco')
  await page.getByLabel('Secret').fill('ghp_e2e_dummy')
  await page.getByRole('button', { name: 'Add Connection' }).click()
  await expect(page.getByText('Not verified yet.')).toBeVisible()
  await page.reload()
  await step(page, 'Connect your forge')
  await page.getByRole('button', { name: 'Verify', exact: true }).click()

  // 2 Pick a product: the repository list streams in, the name follows the repository
  await step(page, 'Pick a product')
  await expect(rail(page, 'Connect your forge')).toContainText('Done')
  await page.reload()
  await step(page, 'Pick a product')
  await expect(page.locator('#setup-repos option[value="newco/shop"]')).toHaveCount(1)
  await page.getByLabel('Repository').fill('newco/shop')
  await expect(page.getByLabel('Product name')).toHaveValue('shop')
  await shoot(page, 'wizard/2-product')
  await page.getByRole('button', { name: 'Create product' }).click()

  // 3 Pick your team: three presets, the roster of the chosen one, Careful puts a security stage on the Workflow
  await step(page, 'Pick your team')
  await expect(rail(page, 'Pick a product')).toContainText('Done')
  await expect(chip(page)).toContainText('Setup 2/5')
  await page.reload()
  await step(page, 'Pick your team')
  const cards = page.getByRole('radiogroup', { name: 'Team' }).getByRole('radio')
  await expect(cards).toHaveCount(3)
  await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: 'Orchestrator', level: 2 })).toBeVisible()
  await shoot(page, 'wizard/3-team-standard', [[1280, 800], [390, 844]])
  await page.getByRole('radio', { name: /^Solo/ }).click()
  await expect(page.getByRole('heading', { name: 'Software engineer', level: 2 })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Roles' }).getByRole('radio')).toHaveCount(1)
  await shoot(page, 'wizard/3-team-solo')
  await page.getByRole('radio', { name: /^Careful/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Roles' }).getByRole('radio', { name: /Security specialist/ })).toBeVisible()
  await shoot(page, 'wizard/3-team-careful', [[1280, 800], [390, 844]])
  await page.getByRole('button', { name: 'Use this team' }).click()

  // 4 Connect a session: an agent key shows the command once; nothing connects, so the line keeps waiting; skip
  await step(page, 'Connect a session')
  await expect(rail(page, 'Pick your team')).toContainText('Done')
  await expect(page.getByText('Waiting for a session…')).toBeVisible()
  await expect(page.getByText('An LLM Connection exists.')).toHaveCount(0)
  await page.getByLabel('Label').fill('wizard laptop')
  await page.getByRole('button', { name: 'Create agent key' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'claude mcp add' })).toContainText('Authorization: Bearer ')
  await expect(page.getByText('Shown once. Copy it now.')).toBeVisible()
  await expect(page.getByText('<your agent key>')).toBeHidden()
  await shoot(page, 'wizard/4-session')
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'claude mcp add' })).toHaveCount(0)
  await expect(page.getByTestId('connect').locator('pre').first()).toContainText('<your agent key>')
  await page.getByRole('button', { name: 'Skip for now' }).click()

  // 5 First request: an open issue of the repository becomes a Ticket in Triage
  await step(page, 'First request')
  await expect(rail(page, 'Connect a session')).toContainText('Done')
  await page.getByRole('link', { name: 'Describe something new' }).click()
  await page.getByRole('button', { name: 'Open the chat' }).click()
  await expect(page.getByTestId('chat-dock').getByTestId('context-chip')).toHaveText(/^New request · /, { timeout: 30_000 })
  await expect(page.getByTestId('chat-dock').getByTestId('product-card')).toHaveCount(0)
  await page.getByRole('link', { name: 'Pick an open issue' }).click()
  await page.getByText('The invoice total is wrong').click()
  await shoot(page, 'wizard/5-request')
  await page.getByRole('button', { name: 'Send to Triage' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Your factory is set up.' })).toBeVisible()
  await expect(page.getByText('Nothing will pick up work yet')).toBeVisible()
  await expect(chip(page)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Open the Workflow' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open the Inbox' })).toBeVisible()
  await shoot(page, 'wizard/6-finish')

  // Done is computed: a reload stays on the finish screen, steps can be revisited, the palette keeps the checklist
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Your factory is set up.' })).toBeVisible()
  for (const l of ['Connect your forge', 'Pick a product', 'Pick your team', 'Connect a session', 'First request']) await expect(rail(page, l)).toContainText('Done')
  await page.goto('/setup?step=team')
  await step(page, 'Pick your team')
  await page.getByRole('button', { name: 'Command palette' }).click()
  await page.getByPlaceholder(/Go to a page/).fill('Setup')
  await expect(page.getByRole('option', { name: 'Setup checklist' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('workflow')).toContainText('Security review')
  await expect(page.getByTestId('workflow')).toContainText('The invoice total is wrong')
})
