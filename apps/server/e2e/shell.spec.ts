import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signOutEmail = 'signout-shell@example.com' // signing out ends every session of the user, so this spec has one of its own

test('shell: sidebar nav, New request, user menu with theme, sign out', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(signOutEmail)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const bar = page.getByRole('banner')
  await expect(bar).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: /^Workflow/ })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: /^Requests/ })).toBeVisible()
  await expect(nav.getByRole('link')).toHaveCount(8) // Inbox, Workflow, Team, Requests, Releases, Knowledge, Runs (Admin), Insights
  await expect(nav.getByRole('link', { name: 'Knowledge' })).toBeVisible()
  await expect(bar.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Workflow')
  await expect(bar.getByRole('link', { name: 'New request' })).toBeVisible()
  await nav.getByRole('link', { name: /^Requests/ }).click()
  await expect(nav.getByRole('link', { name: /^Requests/ })).toHaveAttribute('aria-current', 'page')
  await expect(bar.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText('Requests')
  await bar.getByRole('link', { name: 'New request' }).click()
  await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible()
  await expect(bar.getByRole('link', { name: 'New request' })).toHaveCount(0)
  await page.goto('/')

  await page.getByRole('button', { name: 'User menu' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toContainText(signOutEmail)
  await expect(menu.getByRole('menuitem', { name: /Release notes/ })).toBeVisible()
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

test('command palette: opens with Ctrl+K, finds a Ticket by number, navigates, and gives focus back', async ({ page }) => {
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
  await page.getByPlaceholder(/Go to a page/).fill('#1')
  const hit = dialog.getByRole('group', { name: 'Tickets' }).getByRole('option').first()
  await expect(hit).toContainText('#1')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/tickets\/\d+$/)
  await expect(dialog).toBeHidden()
})

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

test('Knowledge link and Workspace switcher are absent for a member with one Workspace without a knowledge repo', async ({ page }) => {
  await signIn(page, 'solo@example.com')
  await expect(nav(page).getByRole('link', { name: 'Workflow' })).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'Knowledge' })).toHaveCount(0)
  // Zeta has its one Product, so the empty Board names the next action instead of asking for an Admin.
  await expect(page.getByText('Describe what you want built.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'New request' }).first()).toBeVisible()
  await expect(page.getByText(/Ask an Admin to set up the Workspace/)).toHaveCount(0)
  await expect(page.getByLabel('Product')).toHaveCount(0)
  await expect(page.getByTestId('workspace-switcher')).toHaveCount(0)
  await expect(page.getByTestId('workspace-name')).toContainText('Zeta')
})

test('An Admin always gets the Workspace menu, with settings and New Workspace', async ({ page }) => {
  await signIn(page, email)
  await page.getByTestId('workspace-switcher').click()
  const m = page.getByRole('menu')
  await expect(m.getByRole('menuitem', { name: 'Workspace settings' })).toBeVisible()
  await m.getByRole('menuitem', { name: 'New Workspace' }).click()
  await expect(page).toHaveURL(/\/settings\/workspace#new-workspace$/)
})

test('the palette offers Set up only while the Workspace has no Ticket yet', async ({ page }) => {
  await signIn(page, email)
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await expect(dialog.getByRole('option', { name: 'Toggle theme' })).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'Set up', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'zeta', url: new URL(page.url()).origin }])
  await page.reload()
  await page.keyboard.press('Control+k')
  await dialog.getByRole('option', { name: 'Set up', exact: true }).click()
  await expect(page).toHaveURL(/\/setup$/)
})

test('Workspace switcher shows with 2+ Workspaces; selecting one switches and drops Knowledge', async ({ page }) => {
  await signIn(page, 'duo@example.com')
  await expect(nav(page).getByRole('link', { name: 'Knowledge' })).toBeVisible()
  await page.getByTestId('workspace-switcher').click()
  const m = page.getByRole('menu')
  await expect(m.getByText('Workspace', { exact: true })).toBeVisible()
  await expect(m.getByRole('menuitem', { name: 'Acme' })).toHaveAttribute('aria-current', 'true')
  await m.getByRole('menuitem', { name: 'Zeta' }).click()
  await expect(nav(page).getByRole('link', { name: 'Knowledge' })).toHaveCount(0)
  await page.getByTestId('workspace-switcher').click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Zeta' })).toHaveAttribute('aria-current', 'true')
})
