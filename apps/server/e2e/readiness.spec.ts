import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const TICKETS = ['No AGENTS.md', 'No issue forms']

const openProduct = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'readiness', url }])
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Readiness App' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+$/)
  return page.getByRole('region', { name: 'Readiness' })
}

const forgetRequiredChecks = async (page: Page) => {
  const id = /products\/(\d+)/.exec(page.url())![1]
  await page.evaluate((product) => fetch(`/api/products/${product}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requiredChecks: '' }),
  }), id)
  await page.reload()
}

test('Readiness counts the gaps and Require these saves the checks after the confirm', async ({ page }) => {
  const section = await openProduct(page)
  await forgetRequiredChecks(page)
  await expect(section.getByText(/^\d+ gaps$/)).toBeVisible()
  await expect(section.getByText('No required checks')).toBeVisible()
  await section.getByRole('button', { name: 'Require these 2' }).click()
  const dialog = page.getByRole('dialog', { name: 'Require these checks?' })
  await expect(dialog).toContainText('lint, test')
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(section.getByText('No required checks')).toHaveCount(0)
  await expect(section).toContainText('required checks that ran (2)')
  await expect(section.getByText('Held up in 30 days')).toBeVisible()
})

test('Make it a ticket opens the issue and the gap reads Ticket #n open', { tag: '@fake-forge' }, async ({ page }) => {
  const title = TICKETS[test.info().retry] ?? ''
  const section = await openProduct(page)
  const row = section.getByRole('listitem').filter({ hasText: title })
  await row.getByRole('button', { name: 'Make it a ticket' }).click()
  await expect(row.getByRole('button', { name: 'Make it a ticket' })).toHaveCount(0)
  await expect(row).toContainText(/Ticket #\d+ open/)
})
