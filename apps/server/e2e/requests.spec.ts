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
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()
  const draft = page.getByTestId('drafts').getByTestId('draft').filter({ hasText: 'Export totals drift' })
  await expect(draft).toContainText('changed')
  await expect(draft.getByRole('link', { name: 'Export totals drift' })).toHaveAttribute('href', /^\/requests\/\d+$/)
  await expect(draft.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(draft.getByRole('button', { name: /^Discard draft: / })).toBeVisible()
  await expect(page.getByTestId('factory-rows')).not.toContainText('Export totals drift') // an own Draft sits in Drafts, not among the sent requests
  const linked = page.getByTestId('factory-row').filter({ hasText: 'Dark theme for the dashboard' })
  await expect(linked).toContainText('by Product widget')
  await expect(page.getByTestId('factory-rows')).not.toContainText(/Linked|Triage|↳|No Ticket yet/)
  await expect(linked.getByTestId('request-status')).toContainText('Waiting for your answer')
  await expect(linked.getByTestId('request-status')).toContainText('waits for the requester')
  await expect(linked.getByTestId('progress-path')).toHaveAttribute('data-step', '1')
  await expect(linked.getByTestId('progress-path').locator('[data-state=current]')).toHaveText('Planned')
  const shots = process.env.SHOTS_DIR
  const shoot = async (name: string) => {
    if (!shots) return
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/${name}-${scheme}-${w}x${h}.png` })
      }
    }
  }
  await shoot('requests')
  await page.setViewportSize({ width: 1280, height: 800 })
  await linked.getByRole('link', { name: 'Dark theme for the dashboard' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByTestId('request-headline')).toContainText('Questions for you.')
  await expect(page.getByTestId('request-next')).toContainText('What happens next')
  await expect(page.getByTestId('progress-path').locator('[data-state=done]')).toHaveText(['Received'])
  await expect(page.getByRole('link', { name: 'Open the issue' })).toHaveAttribute('href', /github\.com\/acme\/web\/issues\/1$/)
  await shoot('request-detail')
  await page.goBack()
  await linked.getByRole('link', { name: /#1/ }).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
})

test('an empty own Draft opens its request page, and Continue draft opens its thread in the dock', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests')
  await page.getByRole('link', { name: 'Export totals drift' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Export totals drift' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Discard draft' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue draft' }).click()
  const dock = page.getByTestId('chat-dock')
  await expect(dock).toBeVisible()
  await expect(dock.getByTestId('context-chip')).toHaveText('New request · Acme Web', { timeout: 30_000 })
  await expect(dock.getByRole('textbox', { name: 'Message the factory' })).toBeVisible()
})

test('/requests/new?session=<id> continues that draft in the dock', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests')
  const href = (await page.getByRole('link', { name: 'Export totals drift' }).getAttribute('href'))!
  await page.goto(`/requests/new?session=${href.split('/').pop()}`)
  await expect(page.getByText('Your draft is open in the chat on the right.')).toBeVisible()
  await expect(page.getByTestId('chat-dock').getByTestId('context-chip')).toHaveText('New request · Acme Web', { timeout: 30_000 })
  await page.goto('/requests/new?session=999999999')
  await expect(page.getByText('Describe what you need in the chat on the right.')).toBeVisible()
})
