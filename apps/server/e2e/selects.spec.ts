import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Connections: GitLab Base URL and the AWS region are prefilled', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/connections')
  const form = page.locator('section', { hasText: 'Add Connection' })
  await form.getByLabel('Kind').selectOption('gitlab')
  await expect(form.getByLabel('Base URL')).toHaveValue('https://gitlab.com')
  await form.getByLabel('Kind').selectOption('llm-provider')
  await form.getByLabel('Provider preset').selectOption('bedrock')
  const region = form.getByLabel('AWS region')
  await expect(region).toHaveRole('combobox')
  await expect(region).toHaveText('us-east-1')
})

test('Members: Role defaults to bauherr and Workspaces are checkboxes, not ids', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/bauherren')
  const add = page.locator('section', { hasText: 'Add Bauherr' })
  await expect(add.getByLabel('Role')).toHaveValue('bauherr')
  await expect(add.getByRole('checkbox', { name: 'Acme' })).toBeChecked()
  await expect(add.getByLabel(/workspace.*id/i)).toHaveCount(0)
})

test('New request: the Product select remembers the last used Product', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  const product = page.getByLabel('Product')
  await expect(product).toHaveRole('combobox')
  await product.click()
  const names = await page.getByRole('option').allInnerTexts()
  test.skip(names.length < 2, 'seed has several Products')
  const last = names[names.length - 1]!
  await page.getByRole('option', { name: last }).click()
  await page.reload()
  await expect(product).toHaveText(last)
  expect(await page.evaluate(() => localStorage.getItem('bauherr-product'))).toMatch(/^\d+$/)
})
