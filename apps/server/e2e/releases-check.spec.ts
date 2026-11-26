import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const UNREAD = 'The repository has not been read yet. Releases appear after the next readiness check.'

test('Releases says the repository was not read and offers Check now', async ({ page }) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'relcheck', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/releases')
  await expect(page.getByText(UNREAD)).toBeVisible()
  await expect(page.getByText('The readiness check has not run for this Product.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check now' })).toBeVisible()
})
