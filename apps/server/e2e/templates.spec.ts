import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const login = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const row = (page: Page, title: string) => page.locator('tr').filter({ has: page.getByRole('link', { name: title, exact: true }) })

test('an Admin renames a heading of the staging summary: preview, save, customised, reset', async ({ page }) => {
  await login(page)
  await page.goto('/settings/templates')
  await expect(row(page, 'Staging summary')).toContainText('Default')
  await page.getByRole('link', { name: 'Staging summary', exact: true }).click()
  const editor = page.getByLabel('Template')
  await expect(editor).toBeVisible()
  await expect(async () => {
    await editor.fill((await editor.inputValue()).replace('## Found on the way', '## Surprises'))
    await expect(page.getByTestId('template-preview').getByRole('heading', { name: 'Surprises' })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByText('No problems found.')).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.goto('/settings/templates')
  await expect(row(page, 'Staging summary')).toContainText('Customised')
  await page.getByRole('link', { name: 'Staging summary', exact: true }).click()
  await expect(page.getByLabel('Template')).toHaveValue(/## Surprises/)
  await page.getByRole('button', { name: 'Reset to default' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset to default' }).click()
  await expect(page.getByLabel('Template')).toHaveValue(/## Found on the way/)
  await expect.poll(async () => { await page.goto('/settings/templates'); return (await row(page, 'Staging summary').textContent()) ?? '' }).toContain('Default')
})

test('a template that loses a part the factory fills cannot be saved, and the finding says which', async ({ page }) => {
  await login(page)
  await page.goto('/settings/templates/staging-summary')
  const editor = page.getByLabel('Template')
  // A fill before hydration changes the DOM only: repeat it until the page reacts.
  await expect(async () => {
    await editor.fill((await editor.inputValue()).replace('## Accept {#accept}', '## Done'))
    await expect(page.getByRole('alert').filter({ hasText: '{#accept}' })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
})

test('the Progress template previews its text with sample values, and an unknown placeholder cannot be saved', async ({ page }) => {
  await login(page)
  await page.goto('/settings/templates')
  await expect(row(page, 'Progress')).toContainText('Default')
  await page.getByRole('link', { name: 'Progress', exact: true }).click()
  const preview = page.getByTestId('template-preview')
  await expect(preview).toContainText('Try it here: https://staging.example.com')
  await expect(preview).toContainText('Security review in progress.')
  await expect(preview).not.toContainText('{{')
  const editor = page.getByLabel('Template')
  await expect(async () => {
    await editor.fill((await editor.inputValue()).replace('Being built.', 'Being built {{nope}}.'))
    await expect(page.getByRole('alert').filter({ hasText: '{{nope}}' })).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
})
