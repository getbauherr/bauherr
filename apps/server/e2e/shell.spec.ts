import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signOutEmail = 'signout-shell@example.com' // signing out ends every session of the user, so this spec has one of its own

test('shell: sidebar nav, home empty state, footer, user menu with theme, sign out', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(signOutEmail)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const bar = page.getByRole('banner')
  await expect(bar).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Home'])
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await expect(bar.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Home')
  await expect(page.getByText('No project is connected to the lean core yet.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Open Products settings' })).toHaveAttribute('href', '/settings/products')

  const footer = page.getByRole('contentinfo')
  await expect(footer).toContainText(/Made with .*love in Cologne, Germany/)
  await expect(footer.getByTestId('app-version')).toHaveText(/^(dev|v\d)/)

  await page.getByRole('button', { name: 'User menu' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByTestId('app-version')).toHaveCount(0)
  const box = await menu.boundingBox()
  for (const name of ['System', 'Light', 'Dark']) {
    const b = await menu.getByRole('menuitemradio', { name }).boundingBox()
    expect(b!.x).toBeGreaterThanOrEqual(box!.x)
    expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width)
  }
  await expect(menu).toContainText(signOutEmail)
  await expect(menu.getByRole('menuitem', { name: /Bauherren|API key/ })).toHaveCount(0)
  await menu.getByRole('group', { name: 'Theme' }).getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(menu).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('sidebar collapses to a rail and stays collapsed after a reload; the Settings link and breadcrumb follow the page', async ({ page }) => {
  await signIn(page, 'member@example.com')
  const sidebar = page.locator('[data-slot=sidebar][data-state]')
  await expect(sidebar).toHaveAttribute('data-state', 'expanded')
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
  await page.reload()
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(page.getByRole('banner').getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('SettingsProfile')
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'API keys' }).click()
  await expect(page.getByRole('banner').getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('SettingsAPI keys')
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await expect(sidebar).toHaveAttribute('data-state', 'expanded')
})

test('command palette: opens with Ctrl+K, finds a Settings page, navigates, and gives focus back', async ({ page }) => {
  await signIn(page, 'member@example.com')
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Go to' })).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'Settings: Account › API keys' })).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'Toggle theme' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Command palette' })).toBeFocused()

  await page.getByRole('button', { name: 'Command palette' }).click()
  await page.getByPlaceholder(/Go to a page/).fill('People')
  const hit = dialog.getByRole('group', { name: 'Go to' }).getByRole('option').first()
  await expect(hit).toContainText('Settings: Workspace › People')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\/bauherren$/)
  await expect(dialog).toBeHidden()
})

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
