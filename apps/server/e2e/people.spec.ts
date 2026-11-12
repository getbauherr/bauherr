import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { confirmClick } from './confirm'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('People: the Admin adds a Product owner with Products, edits the assignment, changes the role and removes the account', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/bauherren')
  const added = `po-${Date.now()}@example.com`
  const add = page.locator('section', { hasText: 'Add Product owner' })
  await add.getByLabel('Email').fill(added)
  await expect(add.getByLabel('Workspace')).toBeVisible()
  await add.getByRole('checkbox', { name: 'Acme Shop' }).check()
  await add.getByRole('button', { name: 'Add Product owner' }).click()
  await expect(add.getByText('Temporary password (shown once)')).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(added) })
  await expect(row).toContainText('Product owner')
  await expect(row).toContainText('Acme Shop')

  await row.getByText('Edit', { exact: true }).click()
  await row.getByLabel('Access').first().selectOption('workspace')
  await row.getByRole('button', { name: 'Save' }).first().click()
  await expect(row.getByRole('status').filter({ hasText: 'Saved' }).first()).toBeVisible()
  await page.reload()
  const again = page.getByRole('row', { name: new RegExp(added) })
  await expect(again).toContainText('All Products of Acme')

  await again.getByText('Edit', { exact: true }).click()
  await confirmClick(again.getByRole('button', { name: 'Make Bauherr' }), again.getByRole('button', { name: /^Confirm: sees the whole Workspace/ }), (t) => expect(page.getByRole('row', { name: new RegExp(added) }).getByRole('cell', { name: 'Bauherr', exact: true })).toBeVisible({ timeout: t }))
  // The armed confirm must not survive the change: the same button now offers the opposite change, unarmed.
  await expect(again.getByRole('button', { name: 'Make Product owner' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('row', { name: new RegExp(added) }).getByRole('cell', { name: 'Bauherr', exact: true })).toBeVisible()

  const last = page.getByRole('row', { name: new RegExp(added) })
  await confirmClick(last.getByRole('button', { name: 'Remove' }), last.getByRole('button', { name: 'Confirm remove' }), (t) => expect(page.getByRole('row', { name: new RegExp(added) })).toHaveCount(0, { timeout: t }))
})

test('People: the seeded Product owner is listed with role and assignment in words; your own row has no role change', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/bauherren')
  const row = page.getByRole('row', { name: /^owner@example\.com/ })
  await expect(row).toContainText('Product owner')
  await expect(row).toContainText('Acme Web')
  await expect(page.getByRole('row', { name: new RegExp(`^${email.replace(/[.+]/g, '\\$&')}`) }).getByRole('button', { name: /Make /})).toHaveCount(0)
})
