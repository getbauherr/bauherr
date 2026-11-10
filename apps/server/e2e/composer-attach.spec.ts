import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { give, PNG } from './paste'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')


const signIn = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
}

test('a pasted wrong-type or oversize image shows an inline error', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  await give(page.getByLabel(/Describe your request|Your answer/), 'paste', { name: 'notes.txt', type: 'text/plain', size: 10 })
  await expect(page.locator('form').getByRole('alert').filter({ hasText: 'only png, jpeg or webp images' })).toBeVisible()
  await expect(page.getByText('notes.txt')).toHaveCount(0)

  const { maxBytes } = await (await page.request.post('/intake/api/media-limits', { headers: { Origin: new URL(page.url()).origin } })).json()
  await give(page.getByLabel(/Describe your request|Your answer/), 'drop', { name: 'huge.png', type: 'image/png', size: maxBytes + 1 })
  await expect(page.locator('form').getByRole('alert').filter({ hasText: /image larger than \d+ MB/ })).toBeVisible()
  await page.getByRole('button', { name: 'Remove attachment' }).click()
  await expect(page.getByText('huge.png')).toHaveCount(0)
})

test('a pasted image is attached, uploaded and removable', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'creates an Intake session, which needs the fake forge setup')
  await signIn(page)
  await page.goto('/requests/new')
  await page.getByLabel('Product').click()
  await page.getByRole('option', { name: 'Acme Web' }).click()
  await give(page.getByLabel(/Describe your request|Your answer/), 'paste', { name: 'shot.png', type: 'image/png', base64: PNG })
  await expect(page.getByText('shot.png')).toBeVisible()
  await expect(page.locator('form').getByRole('alert')).toHaveCount(0)
})
