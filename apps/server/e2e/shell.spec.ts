import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('slim shell: nav, New request, avatar menu with theme, no Workspace control, sign out', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const bar = page.locator('header.topbar')
  await expect(bar).toBeVisible()
  const nav = bar.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: /^Tickets/ })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link')).toHaveCount(2)
  await expect(nav.getByRole('link', { name: 'Knowledge' })).toBeVisible()
  await expect(bar.getByRole('link', { name: 'New request' })).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'New request' })).toHaveCount(1)

  await bar.getByRole('button', { name: 'User menu' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toContainText(email)
  await expect(menu.getByText('Workspace', { exact: true })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Bauherren|API key/ })).toHaveCount(0)
  await menu.getByRole('group', { name: 'Theme' }).getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(menu).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})
