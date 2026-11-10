import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const email = 'draft-owner@example.com' // owns the seeded Draft (seed-e2e.ts)

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Requests list shows Draft and Sent rows with plain wording and Ticket links', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.getByRole('link', { name: /^Requests/ }).click()
  await page.getByRole('link', { name: 'New request' }).first().click()
  await page.locator('.intake').getByRole('link', { name: 'Requests', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()
  const draft = page.locator('tbody tr').filter({ hasText: 'Export totals drift' })
  await expect(draft).toContainText('Draft')
  await expect(draft.getByRole('link', { name: 'Export totals drift' })).toHaveAttribute('href', /^\/requests\/new\?session=\d+$/)
  await expect(draft).not.toContainText('Ticket')
  const linked = page.locator('tbody tr').filter({ hasText: 'Dark theme for the dashboard' })
  await expect(linked).toContainText('Sent')
  await expect(page.locator('tbody')).not.toContainText(/Linked|Triage|↳|No Ticket yet/)
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/requests-${scheme}-${w}x${h}.png` })
      }
    }
  }
  await linked.getByRole('link', { name: /#1/ }).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
})

test('an own Draft opens from Requests after logout and login and is finished and sent', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')
  const signIn = async () => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('signout-requests@example.com') // signing out ends every session of the user, so this test has one of its own
    await page.getByLabel('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('banner')).toBeVisible()
  }
  const say = async (text: string, reply: string) => {
    await page.getByLabel(/Describe your request|Your answer/).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('[data-role=assistant]').last()).toHaveText(reply)
  }
  await signIn()
  await page.goto('/requests/new')
  await page.getByLabel('Product').click()
  await page.getByRole('option', { name: 'Acme Web' }).click()
  await say('The reopen check is broken', 'Who is affected, and since when?')
  await page.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL('**/login')
  await signIn()
  await page.goto('/requests')
  await page.locator('tbody tr').filter({ hasText: 'The reopen check is broken' }).getByRole('link', { name: 'The reopen check is broken' }).click()
  await expect(page).toHaveURL(/\/requests\/new\?session=\d+/)
  await expect(page.locator('[data-role=user]').first()).toHaveText('The reopen check is broken')
  await say('Finance, last week', 'How should it work once it is fixed?')
  await say('Totals should match', 'Anything to add before I send this?')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText(/Request #\d+ sent/)
})

test('an empty own Draft opens its session', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests')
  await page.getByRole('link', { name: 'Export totals drift' }).click()
  await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible()
  await expect(page).toHaveURL(/\/requests\/new\?session=\d+/)
  await expect(page.getByLabel('Describe your request')).toBeVisible()
})

test('New request hides the Product select for a single-Product Workspace', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('solo@example.com')
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests/new')
  await expect(page.getByLabel('Describe your request')).toBeVisible()
  await expect(page.getByLabel('Product')).toHaveCount(0)
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/new-request-single-product-${scheme}-${w}x${h}.png` })
      }
    }
  }
})
