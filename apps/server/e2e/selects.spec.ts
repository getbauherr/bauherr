import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const fake = !!process.env.E2E_FAKE_FORGE // the fake forge lists repositories; the real one fails with the dummy token (the fallback)

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Workspace: model tiers are selects with Other..., the Knowledge repo is a select or, with a failing forge, text', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/workspace')
  const tier = page.getByLabel('Standard', { exact: true })
  await expect(tier).toHaveRole('combobox')
  await tier.click()
  await expect(page.getByRole('option')).toHaveText(['Preset default (claude-sonnet-5-5)', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'Other...'])
  await page.getByRole('option', { name: 'Other...' }).click()
  await expect(page.getByLabel('Standard, other')).toBeVisible()
  await page.reload()

  const repo = page.getByLabel('Repository', { exact: true })
  if (fake) {
    await expect(repo).toHaveRole('combobox')
    await expect(repo).toHaveText('acme/knowledge')
    await repo.click()
    await page.getByRole('option', { name: 'Other...' }).click()
    await page.getByLabel('Repository, other').fill('acme/knowledge') // the typed value must post under the field name
  } else {
    await expect(page.getByText('Could not list repositories; type owner/name.')).toBeVisible()
    await expect(repo).toHaveJSProperty('tagName', 'INPUT')
    await expect(repo).toHaveValue('acme/knowledge')
  }
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  const saved = page.getByLabel('Repository', { exact: true })
  if (fake) await expect(saved).toHaveText('acme/knowledge')
  else await expect(saved).toHaveValue('acme/knowledge')
})

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
