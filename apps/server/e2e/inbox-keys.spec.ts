import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const LIVE = 'Result for the live refresh'

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
}

const rows = (page: Page) => page.locator('[data-inbox-row]')
const focused = (page: Page) => page.locator('[data-inbox-row]:focus')

test('j, k and o move the focus across groups and open the row', async ({ page }) => {
  await signIn(page)
  const all = rows(page)
  const count = await all.count()
  expect(count).toBeGreaterThan(2)
  expect(await page.locator('section[aria-labelledby] li').count(), 'rows in at least two groups').toBe(count)
  await page.keyboard.press('j')
  await expect(focused(page)).toHaveAttribute('data-inbox-row', (await all.nth(0).getAttribute('data-inbox-row'))!)
  await page.keyboard.press('j')
  await expect(all.nth(1)).toBeFocused()
  await page.keyboard.press('k')
  await expect(all.nth(0)).toBeFocused()
  const href = await all.nth(0).getAttribute('href')
  await page.keyboard.press('o')
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === href)
  expect(href).toMatch(/^\/(tickets\/|inbox\?t=)\d+$/)
})

test('ArrowDown walks over every row and into the next group; Esc clears the focus', async ({ page }) => {
  await signIn(page)
  const count = await rows(page).count()
  const groupOf = (index: number) => rows(page).nth(index).locator('xpath=ancestor::section')
  for (let i = 0; i < count; i++) await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(count - 1)).toBeFocused()
  expect(await groupOf(count - 1).getAttribute('id')).not.toBe(await groupOf(0).getAttribute('id'))
  await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(count - 1)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(rows(page).nth(count - 2)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(focused(page)).toHaveCount(0)
})

test('Enter opens the focused row', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('j')
  const href = await focused(page).getAttribute('href')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === href)
})

test('the keys do nothing while focus is in an input or an open dialog', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('j')
  await expect(rows(page).nth(0)).toBeFocused()
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  const input = palette.locator('input')
  await expect(input).toBeFocused()
  await page.keyboard.press('j')
  await expect(input).toHaveValue('j')
  await expect(rows(page).nth(1)).not.toBeFocused()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard keys' })
  await expect(help).toBeVisible()
  await page.keyboard.press('j')
  await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(1)).not.toBeFocused()
  await expect(rows(page).nth(2)).not.toBeFocused()
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
  await page.keyboard.press('j')
  await expect(rows(page).nth(1)).toBeFocused()
})

test('? lists every key in a dialog and Esc closes it', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard keys' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('term')).toHaveText(['j or ArrowDown', 'k or ArrowUp', 'o or Enter', 'Esc', '?'])
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('the live refresh keeps the focused Ticket focused when rows change', async ({ page, context }) => {
  await signIn(page)
  const count = await rows(page).count()
  for (let i = 0; i < count; i++) await page.keyboard.press('j')
  const key = await focused(page).getAttribute('data-inbox-row')
  expect(key).toBeTruthy()
  await expect(focused(page)).not.toContainText(LIVE)
  const other = await context.newPage()
  await other.goto('/inbox')
  await other.getByRole('link', { name: new RegExp(LIVE) }).click()
  await other.getByRole('button', { name: 'Accept', exact: true }).click()
  const waitingOnYou = other.getByRole('region', { name: 'Waiting on you' })
  await expect(waitingOnYou.getByRole('link', { name: new RegExp(LIVE) })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Done' }).getByRole('link', { name: new RegExp(LIVE) })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator(`[data-inbox-row="${key}"]`)).toBeFocused()
})

test('reduced motion leaves the rows without transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page)
  const durations = await rows(page).evaluateAll((all) =>
    all.map((row) => getComputedStyle(row).transitionDuration),
  )
  expect(new Set(durations)).toEqual(new Set(['0s']))
})
