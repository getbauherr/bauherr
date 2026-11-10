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
    // The groups follow the workflow: Plan before Review before Staging.
    const heads = await page.locator('section[aria-label] > h2').allTextContents()
    const at = (c: string) => heads.findIndex((h) => h.startsWith(c))
    expect(at('Plan')).toBeLessThan(at('Review'))
    expect(at('Review')).toBeLessThan(at('Staging'))
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

test('an Inbox with nothing in it says so in one line', async ({ page }) => {
  await login(page, 'solo@example.com')
  await page.goto('/inbox')
  await expect(page.getByText('Nothing needs you. The factory is working on 0 tickets.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open the Tickets' })).toBeVisible()
})
