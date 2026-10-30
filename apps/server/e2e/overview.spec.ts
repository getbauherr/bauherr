import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('List, Board and Runs views, remembered tab, Product filter', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const tabs = page.getByRole('navigation', { name: 'View' })
  await expect(page.getByRole('heading', { name: /^Needs you/ })).toBeVisible()
  expect(await page.locator('section', { has: page.getByRole('heading', { name: /^Needs you/ }) }).locator('li').count()).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByLabel(/need you/)).toBeVisible()

  await tabs.getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('.board .col')).toHaveCount(6)

  await tabs.getByRole('link', { name: 'Runs' }).click()
  await expect(page.locator('table tbody tr')).toHaveCount(3)

  await page.goto('/')
  await expect(page).toHaveURL(/view=runs/)
  await expect(page.locator('table')).toBeVisible()

  await tabs.getByRole('link', { name: 'List' }).click()
  const rows = page.locator('ul.list li')
  await expect(rows.first()).toBeVisible()
  const before = await rows.count()
  await page.getByLabel('Product').selectOption({ label: 'Acme Shop' })
  await expect(page).toHaveURL(/product=/)
  await expect.poll(() => rows.count()).toBeLessThan(before)
})
