import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const enter = async (page: Page, path: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto(path)
}

test('a ticket with a live review run shows Review in Verify', async ({ page }) => {
  await enter(page, '/')
  const verify = page.getByRole('region', { name: 'Factory board' }).getByRole('region', { name: 'Verify' })
  const title = page.getByRole('link', { name: 'Review of the export patch' })
  const card = verify.getByRole('listitem').filter({ has: title })
  await expect(card.getByText('Reviewing', { exact: true })).toBeVisible()
})

test('a Result card names the review run next to the verifier run', async ({ page }) => {
  await enter(page, '/')
  await page.getByRole('link', { name: 'Add target-year check' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Add target-year check' })).toBeVisible()
  await expect(page.getByText(/reviewed by run \d+/)).toBeVisible()
})
