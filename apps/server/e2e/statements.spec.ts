import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const openProduct = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page
    .context()
    .addCookies([{ name: 'bauherr-ws', value: 'record', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Record App', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Record App' })).toBeVisible()
}

test('Product settings list each Statement with its record, flag a repeat and offer an unused one for removal', async ({
  page,
}) => {
  await openProduct(page)
  const table = page.locator('#statements').getByRole('table', { name: 'Statement records' })
  const queue = table.getByRole('row', { name: /Never block the queue/ })
  await expect(queue.getByRole('cell').nth(1)).toHaveText('3')
  await expect(queue.getByRole('cell').nth(2)).toHaveText('2')
  await expect(queue).not.toContainText('Make this a check')
  const cite = table.getByRole('row', { name: /Always cite the failing test/ })
  await expect(cite.getByRole('cell').nth(1)).toHaveText('4')
  await expect(cite.getByRole('cell').nth(2)).toHaveText('3')
  await expect(cite).toContainText('Make this a check')
  const unused = page.getByRole('group', { name: 'Unused Statements' })
  await expect(unused).toContainText('Old rule nobody hit')
  await expect(unused).not.toContainText('Never block the queue')
})

test('Remove opens a dialog and deletes the Statement only after the confirmation', async ({ page }) => {
  await openProduct(page)
  const unused = page.getByRole('group', { name: 'Unused Statements' })
  await unused.getByRole('button', { name: 'Remove' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Old rule nobody hit')
  await dialog.getByRole('button', { name: 'Keep Statement' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(unused).toContainText('Old rule nobody hit')
  await unused.getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove Statement' }).click()
  await expect(page.locator('#statements')).not.toContainText('Old rule nobody hit')
  await page.reload()
  await expect(page.locator('#statements')).toContainText('Never block the queue')
  await expect(page.locator('#statements')).not.toContainText('Old rule nobody hit')
})
