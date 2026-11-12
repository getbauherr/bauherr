import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')
void confirmClick

// Own Workspace (slug `who-lab`), own Bauherr and Product owner (seed-e2e.ts): Who Alpha has the Product owner and "Product owner tests on staging" on, Who Beta has none. Each Product has #1 on staging, #2 a plan to approve (the Bauherr's) and #3 held by Triage with a mixed sheet (D1 for the Bauherr, D2 and D3 for the Product owner).
const owner = 'who-po@example.com'
const bauherr = 'who-bauherr@example.com'
const shots = process.env.SHOTS_DIR && `${process.env.SHOTS_DIR}`
test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

const signIn = async (page: Page, who: string) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'who-lab', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const shoot = async (page: Page, name: string) => {
  if (!shots) return
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${shots}/${name}-${scheme}.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}
const card = (page: Page, title: string) => page.locator('article[data-decision]').filter({ hasText: title })
const badge = async (page: Page) => Number((await page.getByRole('navigation', { name: 'Main' }).getByLabel(/need you/).textContent()) ?? 0)
const hrefs: Record<string, string> = {}

test('a Product owner\'s Inbox holds only what asks them on their Products, and they accept on staging from the card', async ({ page }) => {
  await signIn(page, owner)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([/^Inbox/, /^Requests/, 'Profile'])
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  // Alpha's staging acceptance and Alpha's questions ask them; the plan is the Bauherr's, Beta has no Product owner.
  const staging = card(page, 'Alpha: check the new header on staging')
  const questions = card(page, 'Alpha: settle the header copy')
  await expect(staging.getByRole('button', { name: 'Accept on staging' })).toBeVisible()
  await expect(questions.getByRole('link', { name: 'Answer questions' })).toBeVisible()
  await expect(page.locator('article[data-decision]')).toHaveCount(2)
  await expect(page.getByRole('main')).not.toContainText(/approve the retry policy|Beta/)
  await expect(page.getByTestId('asked')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Workflow|Runs|Agent team|Insights/ })).toHaveCount(0)
  expect(await badge(page)).toBe(2)
  hrefs.questions = (await questions.getByRole('link', { name: 'Answer questions' }).getAttribute('href'))!
  await shoot(page, 'inbox-product-owner')

  await staging.getByRole('button', { name: 'Accept on staging' }).click()
  await expect(staging).toBeHidden()
  await expect.poll(() => badge(page)).toBe(1)
  await page.reload()
  await expect(card(page, 'Alpha: check the new header on staging')).toHaveCount(0)
  expect(await badge(page)).toBe(1)

  // The Bauherr's plan of Product B is nobody's business here: every door answers 404.
  const other = hrefs.questions!.replace(/\/tickets\/\d+/, '/tickets/999999')
  expect((await page.goto(other))?.status()).toBe(404)
})

test('a mixed decision sheet: the Product owner sees and answers their rows, the Bauherr all of them', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000)
  await signIn(page, owner)
  await page.goto(hrefs.questions!)
  const shell = page.getByTestId('conversation-shell')
  await expect(shell).toBeVisible()
  await expect(page.getByTestId('refine-thread')).toContainText('Triage asked 2 questions')
  const panel = page.getByTestId('artifact-panel')
  await expect(panel.getByTestId('points-count')).toHaveText('2 of 2 open')
  await expect(panel.locator('[data-point=D1]')).toHaveCount(0) // the Bauherr's row
  await expect(panel.locator('[data-point=D2]')).toBeVisible()
  await expect(panel.locator('[data-point=D3]')).toBeVisible()
  // no model choice, no cost, no model name, no Run link
  await expect(page.getByTestId('model-chip')).toHaveCount(0)
  await expect(page.getByTestId('cost-chip')).toHaveCount(0)
  await expect(page.getByTestId('header-model')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Run #\d+/ })).toHaveCount(0)
  await shoot(page, 'mixed-sheet-product-owner')

  await page.getByTestId('current-point').getByRole('button', { name: /Welcome back/ }).click()
  await expect(panel.getByTestId('points-count')).toHaveText('1 of 2 open')
  await expect(panel.locator('[data-point=D2]')).toHaveAttribute('data-status', 'done')
  // the Bauherr's row holds sending, for everyone
  await expect(panel.getByTestId('send-to-planning')).toBeDisabled()

  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  const boss = await ctx.newPage()
  await signIn(boss, bauherr)
  await boss.goto('/inbox')
  const asked = card(boss, 'Alpha: settle the header copy')
  await expect(asked.getByTestId('asked')).toHaveText('Asked: Product owner')
  await expect(card(boss, 'Alpha: approve the retry policy').getByTestId('asked')).toHaveCount(0)
  await expect(card(boss, 'Beta: settle the header copy').getByTestId('asked')).toHaveCount(0) // no Product owner on Beta: it asks the Bauherr
  await asked.getByRole('link', { name: 'Answer questions' }).click()
  await expect(boss.getByTestId('refine-thread')).toContainText('Triage asked 3 questions')
  const all = boss.getByTestId('artifact-panel')
  await expect(all.getByTestId('points-count')).toHaveText('2 of 3 open')
  for (const d of ['D1', 'D2', 'D3']) await expect(all.locator(`[data-point=${d}]`)).toBeVisible()
  await expect(all.locator('[data-point=D2]')).toHaveAttribute('data-status', 'done')
  await expect(boss.getByTestId('model-chip')).toBeVisible()
  await expect(boss.getByTestId('cost-chip')).toBeVisible()
  await shoot(boss, 'mixed-sheet-bauherr')
  await ctx.close()
})
