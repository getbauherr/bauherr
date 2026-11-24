import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const WANTS = 'A forge answer that says "not in your plan" is an empty answer.'
const PRESSED = ['A migration needs a timestamp prefix no other migration has.', 'Never open an issue on a real forge.']

const openMemory = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page
    .context()
    .addCookies([{ name: 'bauherr-ws', value: 'check', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/memory/statements')
  await expect(page.getByRole('heading', { name: 'Memory', level: 1 })).toBeVisible()
}

test('a memory that came back three times shows Wants a check on the list and under its filter', async ({ page }) => {
  await openMemory(page)
  const table = page.getByRole('table', { name: 'Memory' })
  await expect(table.getByRole('row', { name: new RegExp(WANTS.replace('.', '\\.')) })).toContainText('Wants a check')
  const filters = page.getByRole('navigation', { name: 'Filter memory' })
  await filters.getByRole('link', { name: /^Wants a check/ }).click()
  await expect(table.getByRole('row', { name: new RegExp(WANTS.replace('.', '\\.')) })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Filter memory' }).getByRole('link', { name: /^Wants a check/ }))
    .toHaveAttribute('aria-current', 'true')
})

const pressing = 'Make it a check opens the ticket and the memory reads Check being built with the issue number'

test(pressing, { tag: '@fake-forge' }, async ({ page }) => {
  const text = PRESSED[test.info().retry] ?? ''
  await openMemory(page)
  await page.getByRole('table', { name: 'Memory' }).getByRole('link', { name: text }).click()
  await expect(page.getByText('Opens a ticket in')).toContainText('check/app')
  await page.getByRole('button', { name: 'Make it a check' }).click()
  await expect(page.getByRole('button', { name: 'Make it a check' })).toHaveCount(0)
  await expect(page.getByText('Check being built').first()).toBeVisible()
  await page.goto('/memory/statements')
  const row = page.getByRole('table', { name: 'Memory' }).getByRole('row', { name: new RegExp(text.slice(0, 20)) })
  await expect(row).toContainText(/Check being built\s+#\d+/)
})
