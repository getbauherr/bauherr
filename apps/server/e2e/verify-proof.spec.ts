import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const pages = (process.env.VERIFY_PAGES ?? '').split(',').filter(Boolean).map((entry) => entry.split('=') as [string, string])
const dir = path.join(process.env.VERIFY_OUT ?? 'e2e/results', 'proof')

test.skip(!email || !process.env.E2E_PASSWORD_FILE || !pages.length, 'set E2E_EMAIL, E2E_PASSWORD_FILE and VERIFY_PAGES')

test('screenshot every page named in VERIFY_PAGES', async ({ page }) => {
  mkdirSync(dir, { recursive: true })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
  for (const [id, route] of pages) {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: path.join(dir, `${id}.png`) })
  }
})
