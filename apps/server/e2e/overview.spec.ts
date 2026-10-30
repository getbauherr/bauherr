import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Board only, Runs on its own page, legacy view URLs redirect, Product filter', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const main = page.getByRole('navigation', { name: 'Main' })
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.board .col')).toHaveCount(6)
  await expect(page.getByRole('navigation', { name: 'View' })).toHaveCount(0)
  await expect(main.getByRole('link', { name: /^Tickets/ })).toHaveAttribute('aria-current', 'page')
  await expect(main.getByLabel(/need you/)).toBeVisible()
  // decision sheets are read from the forge; the production image has no fake forge
  if (process.env.E2E_FAKE_FORGE) await expect(page.locator('.col[data-stage=plan] .card').filter({ hasText: 'Answer decisions' }).first()).toBeVisible()

  await expect(page.locator('.col[data-stage=plan] .card [data-gate]').first()).toContainText(/@e2e-admin · waiting \d+[mh]/)

  const cards = page.locator('.card')
  const before = await cards.count()
  await page.getByLabel('Product').selectOption({ label: 'Acme Shop' })
  await expect(page).toHaveURL(/product=/)
  await expect.poll(() => cards.count()).toBeLessThan(before)

  await page.goto('/?view=list&state=all')
  await expect(page).toHaveURL(/\/\?state=all$/)
  await expect(page.locator('.board')).toBeVisible()

  await page.goto('/?view=runs&product=999999')
  await expect(page).toHaveURL(/\/runs\?product=999999$/)
  await page.goto('/?view=runs')
  await expect(page).toHaveURL(/\/runs$/)
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(4)
  await expect(main.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
  await expect(main.getByRole('link', { name: /^Tickets/ })).not.toHaveAttribute('aria-current', 'page')
  await page.getByLabel('Product').selectOption({ label: 'Acme Shop' })
  await expect(page).toHaveURL(/\/runs\?product=/)
  await expect(page.locator('table tbody tr')).toHaveCount(2)
})

test('drag a Board card above another: the order survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const titles = () => page.locator('.col[data-stage=build] .card .ticket-title').allTextContents()
  const a = 'Blocker: migrate the invoice table'
  const b = 'Export invoices as CSV'
  await expect(page.locator('.col[data-stage=build] .card')).not.toHaveCount(0)
  const [first, second] = (await titles()).indexOf(a) < (await titles()).indexOf(b) ? [a, b] : [b, a]
  await page.locator('.col[data-stage=build] .card', { hasText: second }).dragTo(page.locator('.col[data-stage=build] .card', { hasText: first }))
  await expect.poll(async () => (await titles()).indexOf(second) < (await titles()).indexOf(first)).toBe(true)
  await expect(async () => {
    await page.reload()
    const after = await titles()
    expect(after.indexOf(second)).toBeLessThan(after.indexOf(first))
  }).toPass()
})
