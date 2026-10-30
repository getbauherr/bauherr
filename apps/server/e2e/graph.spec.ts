import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Graph view: blocked-by chain, ready marker, critical path, node link, no overflow at phone width', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()

  const tabs = page.getByRole('navigation', { name: 'Tickets layout' })
  await tabs.getByRole('link', { name: 'Graph' }).click()
  await expect(page).toHaveURL(/\?view=graph/)
  await expect(tabs.getByRole('link', { name: 'Graph' })).toHaveAttribute('aria-current', 'page')

  const node = (n: number) => page.locator(`a.gnode[data-ticket="${n}"]`)
  await expect(page.locator('.gedge')).toHaveCount(2)
  await expect(page.locator('.gedge[data-critical]')).toHaveCount(2)
  await expect(node(8)).toHaveAttribute('data-ready', 'true')
  await expect(node(8)).toHaveAttribute('aria-label', /^#8 .*, stage build, ready$/)
  await expect(node(8).locator('text.ready')).toBeVisible()
  await expect(node(9)).not.toHaveAttribute('data-ready', /.*/)
  await expect(node(9)).toHaveAttribute('aria-label', /, blocked by #8$/)
  await expect(node(10)).toHaveAttribute('data-critical', 'true')
  await expect(page.getByRole('list', { name: 'Legend' })).toContainText('critical path')
  await expect(page.getByRole('heading', { name: /^No dependencies \(\d+\)/ })).toBeVisible()

  await tabs.getByRole('link', { name: 'Board' }).click()
  await expect(page.locator('.board')).toBeVisible()
  await page.goto('/?view=graph')
  await node(9).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?view=graph')
  await expect(node(8)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
