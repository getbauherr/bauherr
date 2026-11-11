import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const shots = process.env.SHOTS_DIR

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const shot = async (page: Page, name: string) => {
  if (!shots) return
  for (const [scheme, size] of [['light', { width: 1280, height: 900 }], ['dark', { width: 1280, height: 900 }], ['light', { width: 390, height: 844 }], ['dark', { width: 390, height: 844 }]] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize(size)
    await page.screenshot({ path: `${shots}/${name}-${scheme}-${size.width}.png`, fullPage: true })
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 1280, height: 900 })
}

test('the Ticket page lists what was asked with its proof, the missing proof and how to try it', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await page.locator('.card', { hasText: 'Ship the proof export' }).first().getByRole('link', { name: /Ship the proof export/ }).click()
  const proof = page.getByTestId('proof-list')
  await expect(proof).toBeVisible()
  const rows = proof.getByTestId('proof-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('The export page shows a Download button')
  const pair = rows.nth(0).getByTestId('proof-pair')
  await expect(pair.getByRole('img')).toHaveCount(2)
  await expect(pair.getByRole('img', { name: 'Export page before the change' })).toBeVisible()
  await expect(pair).toContainText('Before')
  await expect(pair).toContainText('After')
  await expect(rows.nth(1)).toContainText('Clicking it saves a CSV file')
  const text = rows.nth(1).getByTestId('proof-text')
  await expect(text.locator('pre')).toBeHidden()
  await text.getByText('Download from a terminal').click()
  await expect(text.locator('pre')).toContainText('INV-1001')
  const preview = rows.nth(1).getByRole('link', { name: 'Try the export page' })
  await expect(preview).toHaveAttribute('href', 'https://preview.example.com/proof/1')
  await expect(preview).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(rows.nth(1).getByRole('link', { name: 'Staging' })).toHaveAttribute('href', 'https://staging.example.com/proof')
  await expect(rows.nth(2)).toContainText('Existing exports keep working')
  await expect(rows.nth(2).getByTestId('no-proof')).toHaveText('No proof')
  await shot(page, 'ticket-proof')

  await pair.getByRole('button', { name: 'Enlarge: Export page with the Download button' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img', { name: 'Export page with the Download button' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Export page with the Download button' })).toBeVisible()
  await shot(page, 'ticket-proof-lightbox')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(pair.getByRole('button', { name: 'Enlarge: Export page with the Download button' })).toBeFocused()
})

test('the proof file is served to signed-in members only, with safe headers', async ({ page, request }) => {
  await signIn(page)
  await page.goto('/')
  await page.locator('.card', { hasText: 'Ship the proof export' }).first().getByRole('link', { name: /Ship the proof export/ }).click()
  const src = await page.getByTestId('proof-pair').getByRole('img').first().getAttribute('src')
  // Fetched from the page like the <img> does: a request without browser headers (Sec-Fetch-Site / Origin) is not a signed-in one for Payload's cookie check.
  const signedIn = await page.evaluate(async (u) => {
    const r = await fetch(u)
    return { status: r.status, type: r.headers.get('content-type'), sniff: r.headers.get('x-content-type-options') }
  }, src!)
  expect(signedIn).toEqual({ status: 200, type: 'image/png', sniff: 'nosniff' })
  expect((await request.get(src!)).status()).toBe(401)
})

test('the accept card in the Inbox carries the same proof', async ({ page }) => {
  test.skip(!process.env.E2E_GATED_PACK, 'the staging checkpoint exists with the gated pack')
  await signIn(page)
  await page.goto('/inbox')
  const card = page.locator('article[data-decision]').filter({ hasText: 'Ship the proof export' })
  await expect(card.getByRole('button', { name: 'Accept on staging' })).toBeVisible()
  await expect(card.getByTestId('proof-row')).toHaveCount(3)
  await expect(card.getByTestId('no-proof')).toHaveCount(1)
  await shot(page, 'inbox-accept-proof')
})

test('Product settings: proof rules are edited in a form and an incomplete rule is refused', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Proof' }).click()
  await page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Checks & merging', exact: true }).click()
  const rule = page.getByTestId('proof-rule').first()
  await expect(rule.getByLabel('Name')).toHaveValue('UI screenshots')
  await expect(rule.getByLabel('What it shows')).toHaveValue('image')
  await expect(rule.getByLabel('Needed when these paths change')).toHaveValue('src/ui/**')
  await expect(rule.getByLabel('Also take it before the change')).toBeChecked()
  await shot(page, 'settings-proof-rules')
  await rule.getByLabel('Command that makes it').fill('')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'rule 1: give the command that makes it' })).toBeVisible()
  await rule.getByLabel('Command that makes it').fill('pnpm screenshots')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await rule.getByLabel('What it shows').selectOption('transcript')
  await expect(rule.getByLabel('Also take it before the change')).toHaveCount(0)
  await rule.getByLabel('What it shows').selectOption('image')
})
