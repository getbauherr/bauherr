import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'brief-lab', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill('brief-bauherr@example.com')
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const open = async (page: Page, title: string) => {
  await page.goto('/')
  await page.locator('.card', { hasText: title }).first().getByRole('link', { name: new RegExp(title) }).click()
}

test('a Ticket at Accept on staging shows the stored approval brief, sections 1 to 6', async ({ page }) => {
  await signIn(page)
  await open(page, 'Ship the invoice download')
  const brief = page.getByTestId('approval-brief')
  await expect(brief).toBeVisible()
  await expect(brief.getByTestId('no-visible-change')).toHaveCount(0)
  const changes = brief.getByTestId('brief-changes').getByRole('listitem')
  await expect(changes).toHaveCount(3)
  await expect(changes.nth(0)).toContainText('Visible')
  await expect(changes.nth(0)).toContainText('Download button on the invoice page')
  await expect(changes.nth(2)).toContainText('Internal')
  await expect(brief.getByTestId('proof-list')).toBeVisible()
  await expect(brief.getByTestId('no-proof')).toHaveText('No proof')
  await expect(brief.getByTestId('proof-waived')).toContainText('No proof for UI change: before/after: no browser on the build host')
  await expect(brief.getByText('Bulk export of all invoices')).toBeVisible()
  await expect(brief.getByText('Low. Revert the merge')).toBeVisible()
  await expect(brief.getByText('CI: 4 of 4 checks passed')).toBeVisible()
  await expect(brief.getByText('Tests added: 2')).toBeVisible()
  await expect(brief.getByText('The button has no loading state (low)')).toBeVisible()
  await expect(brief.getByRole('link', { name: 'Merge request #7' })).toHaveAttribute('href', 'https://github.com/acme/brief/pull/7')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { localStorage.setItem('bauherr-theme', t); document.documentElement.dataset.theme = t; return Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {}))) }, theme) // axe must not read colours mid-transition
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).include('[data-testid="approval-brief"]').analyze()
    expect(violations.map((v) => `${theme}: ${v.id}: ${v.help}`)).toEqual([])
  }
})

test('a change without a visible bullet says "No visible change" and why', async ({ page }) => {
  await signIn(page)
  await open(page, 'Speed up the invoice query')
  const none = page.getByTestId('approval-brief').getByTestId('no-visible-change')
  await expect(none).toContainText('No visible change.')
  await expect(none).toContainText('Nothing a person sees changes: The invoice query uses an index')
})

test('the Inbox card of the same Ticket shows the brief', async ({ page }) => {
  await signIn(page)
  await page.goto('/inbox')
  await page.getByText('Ship the invoice download').first().click()
  await expect(page.getByTestId('approval-brief')).toContainText('Finance clerks get a Download button')
})
