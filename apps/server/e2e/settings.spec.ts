import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Admin edits budget, adds a Connection with a missing field and a Bauherr', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  const bar = page.locator('header.topbar')
  await expect(bar).toBeVisible()

  await bar.locator('summary', { hasText: /\S/ }).first().click()
  await page.getByRole('link', { name: 'Workspace settings' }).click()
  await expect(page).toHaveURL(/\/settings\/workspace$/)
  const amount = String(40 + (Date.now() % 50))
  await page.getByLabel('Budget per 30 days').fill(amount)
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Budget per 30 days')).toHaveValue(amount)

  await page.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('cell', { name: 'acme/web' }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Connections' }).click()
  const form = page.locator('section', { hasText: 'Add Connection' })
  const name = `Bedrock ${Date.now()}`
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Kind').selectOption('llm-provider')
  await form.getByLabel('Provider preset').selectOption('bedrock')
  await form.getByLabel('Secret').fill('dummy')
  await form.getByRole('button', { name: 'Add Connection' }).click()
  await expect(form.getByText('required for bedrock')).toBeVisible()
  await form.getByLabel('AWS region').fill('us-east-1')
  await form.getByRole('button', { name: 'Add Connection' }).click()
  await expect(page.getByRole('cell', { name })).toBeVisible()

  await page.getByRole('link', { name: 'Bauherren' }).click()
  const added = `new-${Date.now()}@example.com`
  const add = page.locator('section', { hasText: 'Add Bauherr' })
  await add.getByLabel('Email').fill(added)
  await add.getByRole('button', { name: 'Add Bauherr' }).click()
  await expect(add.getByText('Temporary password (shown once)')).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(added) })
  await expect(row).toContainText('bauherr')
  await expect(row).toContainText('Acme')
})
