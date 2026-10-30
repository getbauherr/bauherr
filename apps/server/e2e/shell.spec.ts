import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('login, Workspace switcher, theme, sign out', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const bar = page.locator('header.topbar')
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Tickets' })).toHaveAttribute('aria-current', 'page')

  const switcher = bar.locator('summary', { hasText: /\S/ }).first()
  await switcher.click()
  await expect(page.locator('.menu form button').first()).toBeVisible()
  await page.keyboard.press('Escape')

  await bar.locator('summary', { hasText: 'Theme' }).click()
  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await bar.locator('summary', { hasText: 'User menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})
