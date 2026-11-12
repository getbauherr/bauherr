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
  await expect(draft.getByRole('link', { name: 'Continue' })).toBeVisible()
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

test('an own Draft opens as a conversation with its card, and can be discarded from its menu', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests')
  await page.getByRole('link', { name: 'Export totals drift' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await expect(page.getByTestId('participant')).toContainText('Factory assistant')
  await expect(page.getByTestId('artifact-panel').locator('[data-field=product]')).toContainText('Acme Web')
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible()
  await page.getByTestId('more').click()
  await expect(page.getByTestId('discard-draft')).toBeVisible()
})

test('/requests/new?session=<id> opens that draft; an unknown one opens an empty draft of the person instead', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests')
  const href = (await page.getByRole('link', { name: 'Export totals drift' }).getAttribute('href'))!
  await page.goto(`/requests/new?session=${href.split('/').pop()}`)
  await expect(page).toHaveURL(new RegExp(`${href}$`))
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await page.goto('/requests/new?session=999999999')
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page).not.toHaveURL(new RegExp(`${href}$`))
  await expect(page.getByTestId('empty-state')).toBeVisible()
})
