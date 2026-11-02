import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE || !process.env.E2E_FAKE_FORGE, 'set E2E_EMAIL, E2E_PASSWORD_FILE and E2E_FAKE_FORGE')

test('edit a Knowledge document: save opens a PR', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()

  await page.goto('/knowledge/edit?path=workspace/rules/style.md')
  await expect(page.getByRole('heading', { name: 'Edit workspace/rules/style.md' })).toBeVisible()
  await page.getByLabel('workspace/rules/style.md').fill('# Style\n\nKeep it very short.\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('opened; it merges when its checks are green')
  await page.getByRole('link', { name: /^#\d+$/ }).waitFor()

  await page.goto('/knowledge/edit?path=image.png')
  await expect(page.getByText('Only Markdown documents of the Knowledge repo can be edited.')).toBeVisible()
})
