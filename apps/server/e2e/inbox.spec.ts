import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const login = async (page: Page, as = email) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(as)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const card = (page: Page, title: string) => page.locator('article[data-decision]').filter({ hasText: title })
const badge = async (page: Page) => Number((await page.getByRole('navigation', { name: 'Main' }).getByLabel(/need you/).textContent()) ?? 0)

test('every decision that is the owner\'s is a card with the ask, the recommendation, the facts and the real options', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  // The plan and staging gates are off in the default workflow: their cards exist only with the gated pack (the fake-forge job).
  const gated = !!process.env.E2E_GATED_PACK
  if (gated) {
    const plan = card(page, 'Rename the sign-in button')
    await expect(plan.getByRole('heading', { name: 'Approve the plan for "Rename the sign-in button"' })).toBeVisible()
    await expect(plan).toContainText('Recommended')
    await expect(plan).toContainText('No data is touched')
    await expect(plan.getByRole('button', { name: 'Approve plan' })).toBeVisible()
    await expect(plan.getByRole('link', { name: 'Read the plan' })).toBeVisible()
  }
  const cap = card(page, 'Stop the export retry loop')
  await expect(cap.getByRole('button', { name: 'Give one more round' })).toBeVisible()
  await expect(cap.getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect(cap).toContainText('1 open finding')
  if (gated) {
    const staging = card(page, 'Check the new header on staging')
    await expect(staging.getByRole('button', { name: 'Accept on staging' })).toBeVisible()
    await expect(staging.getByRole('link', { name: 'Staging', exact: true })).toBeVisible()
    // The groups follow the workflow: Approve plan before Review before Accept on staging.
    const heads = await page.locator('section[aria-label] > h2').allTextContents()
    const at = (c: string) => heads.findIndex((h) => h.startsWith(c))
    expect(at('Approve plan')).toBeLessThan(at('Review'))
    expect(at('Review')).toBeLessThan(at('Accept on staging'))
  }
})

test('a destructive option asks in a dialog first and changes nothing when cancelled', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  const cap = card(page, 'Stop the export retry loop')
  await cap.getByRole('button', { name: 'Stop' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('The change stays open; the ticket goes back to triage.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(cap).toBeVisible()
})

test('approving the plan on its card moves the ticket on, the card goes and the count drops', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')
  await login(page)
  await page.goto('/inbox')
  const before = await badge(page)
  const plan = card(page, 'Rename the sign-in button')
  await plan.getByRole('button', { name: 'Approve plan' }).click()
  await expect(plan).toBeHidden()
  await expect.poll(() => badge(page)).toBe(before - 1)
  await page.reload()
  await expect(card(page, 'Rename the sign-in button')).toHaveCount(0)
  expect(await badge(page)).toBe(before - 1)
})

test('a pending skill proposal is a card with approve and reject; rejecting it closes the card', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the fake forge (the proposal PR lives in acme/knowledge)')
  await login(page)
  await page.goto('/inbox')
  const skill = card(page, 'retry-limits')
  await expect(skill.getByRole('heading', { name: /Merge the skill "retry-limits" learned from #303/ })).toBeVisible()
  await expect(skill.getByText('Skill proposal', { exact: true })).toBeVisible()
  await expect(skill).toContainText('75% against 25%')
  await expect(skill.getByRole('button', { name: 'Approve skill proposal' })).toBeVisible()
  await skill.getByRole('button', { name: 'Reject' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Closes the pull request; nothing is merged.')
  await dialog.getByRole('textbox').fill('too narrow')
  const done = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/inbox') // the card leaves at once; wait for the action before reloading
  await dialog.getByRole('button', { name: 'Reject' }).click()
  await done
  await expect(skill).toBeHidden()
  await page.reload()
  await expect(card(page, 'retry-limits')).toHaveCount(0)
  await page.goto('/knowledge')
  await page.getByTestId('closed-proposals').locator('summary').click()
  await expect(page.getByTestId('closed-proposals')).toContainText('too narrow')
})

test('an Inbox with nothing in it says so in one line', async ({ page }) => {
  await login(page, 'solo@example.com')
  await page.goto('/inbox')
  await expect(page.getByText('Nothing needs you. The factory is working on 0 tickets.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open the Workflow' })).toBeVisible()
})

test('approving a plan in the chat closes its Inbox card', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE || !process.env.CHAT_FAKE, 'needs E2E_FAKE_FORGE=1 and CHAT_FAKE=1')
  await login(page)
  await page.goto('/inbox')
  const plan = card(page, 'Hand over the export notes')
  await expect(plan).toBeVisible()
  await page.getByTestId('chat-open').click()
  const dock = page.getByTestId('chat-dock')
  const input = dock.getByRole('textbox', { name: 'Message the factory' })
  await input.fill('approve #40')
  await input.press('Enter')
  await dock.getByTestId('confirm-card').getByRole('button', { name: 'Approve' }).click({ timeout: 30_000 })
  await expect(dock.getByTestId('confirm-outcome')).toBeVisible({ timeout: 30_000 })
  await expect(plan).toHaveCount(0, { timeout: 30_000 })
  await page.reload()
  await expect(card(page, 'Hand over the export notes')).toHaveCount(0)
})

test('the Workflow view and the Inbox link to each other by checkpoint', async ({ page }) => {
  test.skip(!process.env.E2E_GATED_PACK, 'the plan checkpoint exists with the gated pack')
  await login(page)
  await page.goto('/?stage=' + encodeURIComponent('plan:gate'))
  const link = page.getByTestId('decide-in-inbox')
  await expect(link).toContainText('Decide in Inbox (')
  await link.click()
  await expect(page).toHaveURL(/\/inbox\?checkpoint=Approve(\+|%20)plan/)
  await expect(page.getByTestId('checkpoint-filter')).toContainText('Approve plan')
  await expect(page.locator('section[aria-label] > h2')).toHaveCount(1)
  await page.getByRole('link', { name: 'Show in workflow' }).click()
  await expect(page.getByTestId('stage-filter')).toContainText('Approve plan')
  await page.locator('[data-testid=ticket-status] [data-testid=status-detail]').first().click()
  await expect(page).toHaveURL(/\/inbox#t\d+/)
  await expect(page.locator('article[data-decision]:focus')).toBeVisible()
  await page.getByRole('link', { name: /Remove the filter/ }).count()
})
