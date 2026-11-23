import { expect, test, type Locator, type Page } from '@playwright/test'
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
}

const waiting = (page: Page) => page.getByRole('region', { name: 'Waiting on you' })
const pane = (page: Page) => page.getByRole('complementary', { name: 'Decision' })

const headingOf = async (row: Locator): Promise<string> => {
  const number = await row.locator('span').nth(0).innerText()
  const title = await row.locator('span').nth(1).innerText()
  return `${number} ${title}`
}

test('selecting a row opens its decision beside the list', async ({ page }) => {
  await signIn(page)
  await expect(pane(page)).toHaveCount(0)
  const second = waiting(page).locator('[data-inbox-row]').nth(1)
  const heading = await headingOf(second)
  const href = await second.getAttribute('href')
  await second.click()
  await expect(page).toHaveURL(new RegExp(`${href!.replace('?', '\\?')}$`))
  await expect(pane(page).getByRole('heading', { level: 2, name: heading })).toBeVisible()
  await expect(second).toHaveAttribute('aria-current', 'true')
  await expect(waiting(page)).toBeVisible()
})

test('?t= opens the pane directly; an unknown id leaves the list alone', async ({ page }) => {
  await signIn(page)
  const first = waiting(page).locator('[data-inbox-row]').first()
  const heading = await headingOf(first)
  await page.goto((await first.getAttribute('href'))!)
  await expect(pane(page).getByRole('heading', { level: 2, name: heading })).toBeVisible()
  await page.goto('/inbox?t=999999')
  await expect(waiting(page)).toBeVisible()
  await expect(pane(page)).toHaveCount(0)
})

test('approving a Brief in the pane moves the row out and selects the next row', async ({ page }) => {
  await signIn(page)
  const row = waiting(page).getByRole('link', { name: /Brief with a decision to approve \d/ }).first()
  const key = await row.getAttribute('data-inbox-row')
  const before = await row.getAttribute('href')
  await page.evaluate(() => Reflect.set(window, 'marker', 'same page'))
  await row.click()
  await pane(page).getByRole('radio', { name: /Disk/ }).check()
  await pane(page).getByRole('button', { name: 'Approve Brief' }).click()
  await expect(waiting(page).locator(`[data-inbox-row="${key}"]`)).toHaveCount(0)
  await expect(page).not.toHaveURL(new RegExp(`${before!.replace('?', '\\?')}$`))
  await expect(waiting(page).locator('[aria-current="true"]')).toHaveCount(1)
  expect(await page.evaluate(() => Reflect.get(window, 'marker'))).toBe('same page')
  const next = waiting(page).locator('[aria-current="true"]')
  await expect(pane(page).getByRole('heading', { level: 2, name: await headingOf(next) })).toBeVisible()
})

test('at 390 px the list is alone and a selected row shows the pane with a Back link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await signIn(page)
  await expect(pane(page)).toHaveCount(0)
  await waiting(page).locator('[data-inbox-row]').first().click()
  await expect(pane(page)).toBeVisible()
  await expect(waiting(page)).toBeHidden()
  await pane(page).getByRole('link', { name: '← Back' }).click()
  await expect(pane(page)).toHaveCount(0)
  await expect(waiting(page)).toBeVisible()
})
