import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('slim shell: nav, New request, avatar menu with theme, sign out', async ({ page }) => {
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
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Bauherren|API key/ })).toHaveCount(0)
  await menu.getByRole('group', { name: 'Theme' }).getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(menu).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const menu = async (page: Page) => {
  await page.getByRole('button', { name: 'User menu' }).click()
  return page.getByRole('menu')
}

test('Knowledge link and Workspace switcher are absent for one Workspace without a knowledge repo', async ({ page }) => {
  await signIn(page, 'solo@example.com')
  await expect(nav(page).getByRole('link', { name: 'Tickets' })).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'Knowledge' })).toHaveCount(0)
  await expect(page.getByText(/Ask an Admin to set up the Workspace/)).toBeVisible()
  await expect(page.getByText('Describe what you want built.')).toHaveCount(0)
  await expect(page.getByLabel('Product')).toHaveCount(0)
  await expect(await menu(page)).toBeVisible()
  await expect(page.getByRole('menu').getByText('Workspace', { exact: true })).toHaveCount(0)
})

test('Workspace switcher shows with 2+ Workspaces; selecting one switches and drops Knowledge', async ({ page }) => {
  await signIn(page, 'duo@example.com')
  await expect(nav(page).getByRole('link', { name: 'Knowledge' })).toBeVisible()
  const m = await menu(page)
  await expect(m.getByText('Workspace', { exact: true })).toBeVisible()
  await expect(m.getByRole('menuitem', { name: 'Acme' })).toHaveAttribute('aria-current', 'true')
  await m.getByRole('menuitem', { name: 'Zeta' }).click()
  await expect(nav(page).getByRole('link', { name: 'Knowledge' })).toHaveCount(0)
  await page.getByRole('button', { name: 'User menu' }).click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Zeta' })).toHaveAttribute('aria-current', 'true')
})
