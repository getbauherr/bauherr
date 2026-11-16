import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Admin deletes a second Workspace, it is archived, and restores it', async ({ page }) => {
  const name = `Doomed ${Date.now()}`
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()

  await page.goto('/settings/workspace')
  await page.getByLabel('Name', { exact: true }).last().fill(name)
  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.context().addCookies([{ name: 'bauherr-ws', value: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/settings/workspace')

  await page.getByRole('button', { name: 'Delete workspace' }).click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: 'Delete workspace' })
  await expect(dialog).toContainText('Restorable until')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(/Type .* to confirm/).fill(name)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  const archived = page.locator('#archived')
  await expect(archived).toContainText(name)
  await page.getByTestId('workspace-switcher').click()
  await expect(page.getByRole('menu').getByText(name)).toHaveCount(0)
  await page.keyboard.press('Escape')

  await archived.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Restore' }).click()
  await expect(page.locator('#archived')).toHaveCount(0)
  await page.getByTestId('workspace-switcher').click()
  await expect(page.getByRole('menu').getByText(name)).toBeVisible()
})
