import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/inbox')
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
  await expect(rows(page).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
}

const rows = (page: Page) => page.locator('[data-inbox-row]')
const current = (page: Page) => page.locator('[data-inbox-row] [aria-current="true"]')

const idOf = (url: string) => new URL(url).searchParams.get('t')

test('the first waiting ticket is open and j and k move the selection through the URL', async ({ page }) => {
  await signIn(page)
  await expect(rows(page).first().getByRole('button')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('j')
  await expect.poll(() => idOf(page.url())).not.toBeNull()
  const second = idOf(page.url())
  await expect(current(page)).toHaveCount(1)
  await page.keyboard.press('k')
  await expect.poll(() => idOf(page.url())).not.toBe(second)
  await page.keyboard.press('k')
  await expect(rows(page).first().getByRole('button')).toHaveAttribute('aria-current', 'true')
})

test('the selected ticket stays in the URL after a reload', async ({ page }) => {
  await signIn(page)
  await rows(page).nth(1).getByRole('button').click()
  await expect.poll(() => idOf(page.url())).not.toBeNull()
  const id = idOf(page.url())
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`t=${id}$`))
  await expect(rows(page).nth(1).getByRole('button')).toHaveAttribute('aria-current', 'true')
})

test('the open ticket link of a row goes to the ticket page', async ({ page }) => {
  await signIn(page)
  const link = rows(page).first().locator('a[href^="/tickets/"]')
  const href = await link.getAttribute('href')
  await link.click({ force: true })
  await expect(page).toHaveURL(new RegExp(`${href}$`))
})

test('/ focuses the composer and the keys do nothing while typing', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('/')
  const composer = page.locator('.aui-composer-input')
  await expect(composer).toBeFocused()
  await page.keyboard.type('jk')
  await expect(composer).toHaveValue('jk')
  expect(idOf(page.url())).toBeNull()
})

test('the keys do nothing while a dialog is open', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.keyboard.press('j')
  await expect(palette.locator('input')).toHaveValue('j')
  expect(idOf(page.url())).toBeNull()
})
