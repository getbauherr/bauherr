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
  await expect(page.getByRole('list', { name: 'Legend' })).toBeHidden()
  await page.getByText('Legend', { exact: true }).click()
  await expect(page.getByRole('list', { name: 'Legend' })).toContainText('critical path')
  await expect(page.getByText(/^No dependencies \(\d+\)/)).toBeVisible()
  if (process.env.SHOTS_DIR) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${process.env.SHOTS_DIR}/graph-legend-open-${scheme}-${w}x${h}.png` })
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
  }
  await expect(page.getByRole('region', { name: 'No dependencies' }).locator('a.gnode').first()).toBeHidden()

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

test('Graph view: execution order, grouped no-dependency grid, running Ticket animates and stops without reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?view=graph')

  await page.getByText(/^No dependencies \(\d+\)/).click()
  const iso = page.locator('section[aria-label="No dependencies"]')
  await expect(iso.locator('a.gnode').first()).toHaveAttribute('data-stage', 'release')
  expect(await iso.locator('a.gnode').count()).toBeGreaterThanOrEqual(20)
  const headings = await iso.locator('h3').allTextContents()
  expect(headings.map((h) => h.replace(/ \(\d+\)$/, ''))).toEqual(['Staging', 'review', 'build', 'plan', 'triage'])
  await expect(iso.locator('details summary')).toHaveText(/^Show \d+ more$/)
  await expect(iso.locator('details a.gnode').first()).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const shots = process.env.SHOTS_DIR
  if (shots) await page.screenshot({ path: `${shots}/graph-running-1280x800.png`, fullPage: true })

  const node = page.locator('a.gnode[data-ticket="123"]')
  await expect(node).toHaveAttribute('data-running', '')
  await expect(node.locator('text.act')).toHaveText('building')
  await expect(node).toHaveAttribute('aria-label', /, building$|, building,/)
  expect(await node.locator('.box').evaluate((e) => getComputedStyle(e).animationName)).toBe('march')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await node.locator('.box').evaluate((e) => getComputedStyle(e).animationName)).toBe('none')
  await expect(node.locator('text.act')).toBeVisible()
  if (shots) await page.screenshot({ path: `${shots}/graph-reduced-motion-1280x800.png`, fullPage: true })
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const runs = await (await page.request.get('/api/runs?where[status][equals]=running&where[stage][equals]=build&limit=50&depth=1')).json()
  // The production-image job serves no /api/runs; the fake-forge job covers the stop.
  if (!runs.docs) return
  const live = runs.docs.find((r: { ticket: { number: number } }) => r.ticket.number === 123)
  const done = await page.request.patch(`/api/runs/${live.id}`, { data: { status: 'succeeded' }, headers: { Origin: new URL(page.url()).origin } })
  expect(done.ok()).toBe(true)
  await expect(node).not.toHaveAttribute('data-running', '', { timeout: 12000 })
  await expect(node.locator('text.act')).toHaveCount(0)
  if (shots) await page.screenshot({ path: `${shots}/graph-stopped-1280x800.png`, fullPage: true })
  await page.request.patch(`/api/runs/${live.id}`, { data: { status: 'running' }, headers: { Origin: new URL(page.url()).origin } })
})
