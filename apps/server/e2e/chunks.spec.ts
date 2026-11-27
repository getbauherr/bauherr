import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { pickUp, stepUp } from './sort'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const enter = async (page: Page, path: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'bulk', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto(path)
}

const keysIn = (rows: Locator) => rows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-inbox-row')))

test('Inbox: Waiting on you is complete, Decided loads 50 rows and Show more adds the next 50', async ({ page }) => {
  await enter(page, '/inbox')
  const waiting = page.locator('[data-inbox-row]').filter({ has: page.locator('.bg-warn') })
  await expect(waiting.first()).toBeVisible()
  const heading = page.getByRole('heading', { level: 2, name: /Waiting on you/ })
  const youTotal = Number(await heading.locator('[data-slot="badge"]').innerText())
  expect(youTotal).toBeGreaterThan(50)
  await expect(waiting).toHaveCount(youTotal)

  const rows = page.locator('[data-inbox-row]').filter({ has: page.locator('svg.lucide-check') })
  const more = page.getByRole('button', { name: 'Show more' }).last()
  await expect(rows).toHaveCount(50)
  await more.scrollIntoViewIfNeeded()
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(100)
  const keys = await keysIn(rows)
  expect(new Set(keys).size, 'no row appears twice').toBe(keys.length)
})

test('Factory lane: 30 cards, Show more adds 30, a loaded card can be moved', async ({ page }) => {
  await enter(page, '/')
  const lane = page.getByRole('region', { name: 'Intake' })
  const cards = lane.locator('[data-card]')
  await expect(cards).toHaveCount(30)
  await lane.getByRole('button', { name: 'Show 30 more' }).click()
  await expect(cards).toHaveCount(60)
  const total = Number(await lane.locator('#stage-intake + .title').innerText())
  expect(total).toBeGreaterThan(60)
  const ids = (await cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-card')))).slice(0, 60)
  expect(new Set(ids).size, 'no card appears twice').toBe(ids.length)

  const moved = lane.locator(`[data-card="${ids[40]}"] [data-card-grip]`)
  await stepUp(page, await pickUp(page, moved))
  await page.keyboard.press('Space')
  await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toContainText(`position 40 of ${total}`)
  await expect(moved).toBeFocused()
  await expect(cards.nth(39)).toHaveAttribute('data-card', ids[40]!)
  await expect(cards).not.toHaveCount(30)
})

test('Requests: 50 rows per page, Show more adds the next 50, the filter counts stay exact', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('po-bulk@example.com')
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/requests?show=live')
  const rows = page.getByRole('row').filter({ has: page.getByRole('link') })
  const live = page.getByRole('navigation', { name: 'Filter' }).getByRole('link', { name: /Live/ })
  const count = Number(await live.locator('.mono').innerText())
  expect(count).toBeGreaterThan(100)
  await expect(rows).toHaveCount(50)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(rows).toHaveCount(100)
  await expect(page.getByText(`${count - 100} not shown`)).toBeVisible()
  await page.getByRole('link', { name: 'Requests', exact: true }).first().click()
  await expect(rows).toHaveCount(100)
})
