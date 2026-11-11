import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.use({ viewport: { width: 1280, height: 2400 } })
test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('workflow-graph')).toBeVisible()
})

test('the graph draws the stages of the workflow in order, with the counts of the list below', async ({ page }) => {
  const nodes = page.getByTestId('stage-node')
  await expect(nodes).toHaveText([/triage/i, /plan/i, /Split/, /build/i, /review/i, /Staging/, /Done/i])
  expect(await nodes.evaluateAll((els) => els.map((e) => e.getAttribute('data-stage')))).toEqual(['triage', 'plan', 'parent', 'build', 'review', 'release', 'done'])
  for (const stage of ['triage', 'plan', 'build', 'review', 'release', 'done']) {
    // the node and the list heading read the same count (a WIP limit set by another spec turns it into "n / limit")
    const count = (await page.locator(`[data-testid=stage-node][data-stage=${stage}] [data-testid=stage-count]`).textContent())!.trim()
    await expect(page.locator(`.col[data-stage=${stage}] h2`)).toContainText(count)
    // the done group is collapsed behind "Show N done"
    if (!count.includes('/') && stage !== 'done') expect(await page.locator(`.col[data-stage=${stage}] .card`).count()).toBe(Number(count))
  }
  // outcome edges: forward solid, backward dashed
  await expect(page.locator('[data-edge="build>review"][data-outcome=done]')).toHaveCount(1)
  await expect(page.locator('[data-edge="review>build"][data-back]')).toHaveCount(1)
  await expect(page.locator('[data-edge="build>plan"][data-back][data-outcome=replan]')).toHaveCount(1)
})

test('a checkpoint node counts the Tickets waiting at it and filters the list', async ({ page }) => {
  const refine = page.locator('[data-testid=checkpoint-node][data-checkpoint="triage:refine"]')
  const waiting = await page.locator('[data-testid=status-detail]', { hasText: /^Answer questions$/ }).count()
  expect(waiting).toBeGreaterThan(0)
  await expect(refine.getByTestId('checkpoint-count')).toHaveText(new RegExp(`^${waiting}\\b`))
  if (process.env.E2E_GATED_PACK) await expect(page.locator('[data-checkpoint="plan:gate"]')).toBeVisible()
  await refine.click()
  await expect(page).toHaveURL(/stage=triage%3Arefine/)
  await expect(page.getByTestId('stage-filter')).toContainText('Answer questions')
  await expect(page.locator('.col .card')).toHaveCount(waiting)
  await expect(page.locator('[data-testid=ticket-list] [data-testid=status-detail]')).toHaveText(Array(waiting).fill('Answer questions'))
})

test('clicking a stage filters the list and survives a reload; a second click clears it', async ({ page }) => {
  const all = await page.locator('.col').count()
  expect(all).toBeGreaterThan(1)
  await page.locator('[data-testid=stage-node][data-stage=review]').click()
  await expect(page).toHaveURL(/stage=review/)
  await expect(page.locator('.col')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.col[data-stage=review]')).toHaveCount(1)
  await expect(page.locator('.col')).toHaveCount(1)
  await expect(page.locator('[data-testid=stage-node][data-stage=review]')).toHaveAttribute('aria-current', 'true')
  await page.locator('[data-testid=stage-node][data-stage=review]').click()
  await expect(page).not.toHaveURL(/stage=/)
  await expect(page.locator('.col')).toHaveCount(all)
})

test('a running Run reads In progress with who runs it, and the word Working never shows', async ({ page }) => {
  const row = page.locator('.col[data-stage=build] .card').filter({ hasText: 'Live build in progress' })
  await expect(row.getByTestId('ticket-status').locator('[data-status=working]')).toHaveText('In progress')
  await expect(row.getByTestId('row-who')).toContainText('Bauherr runner')
  await expect(page.locator('main')).not.toContainText(/\bWorking\b/)
  await expect(page.locator('[data-testid=stage-node][data-stage=build] [data-testid=stage-execs] li').first()).toHaveAttribute('title', /Bauherr runner · claude-sonnet-4-5 · #123 building/)
})

test('ranking by drag persists after a reload', async ({ page }) => {
  const col = page.locator('.col[data-stage=review]')
  const titles = () => col.locator('.card .ticket-title').allTextContents()
  const start = await titles()
  const [first, last] = [start[start.length - 2]!, start[start.length - 1]!]
  await col.locator('.card', { hasText: last }).dragTo(col.locator('.card', { hasText: first }))
  await expect.poll(async () => (await titles()).indexOf(last) < (await titles()).indexOf(first)).toBe(true)
  await expect(async () => {
    await page.reload()
    const after = await titles()
    expect(after.indexOf(last)).toBeLessThan(after.indexOf(first))
  }).toPass()
})

test('phone: the graph is a column of the same cards with the transitions as text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByTestId('stage-node').first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'Transitions of build' })).toContainText('replan → Plan (back)')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

const fits = (page: import('@playwright/test').Page) =>
  page.getByTestId('workflow-graph').evaluate((el) => {
    const done = el.querySelector('[data-stage=done]')!.getBoundingClientRect()
    return { wrapper: el.scrollWidth <= el.clientWidth, page: document.documentElement.scrollWidth <= window.innerWidth, done: done.left >= 0 && done.right <= window.innerWidth, width: Math.round(el.clientWidth) }
  })

test('the whole graph fits its container at 1280x800: dock closed, dock open, sidebar collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.reload()
  await expect(page.getByTestId('workflow-graph')).toBeVisible()
  expect(await fits(page)).toMatchObject({ wrapper: true, page: true, done: true })
  await page.getByTestId('chat-open').click()
  await expect(page.getByTestId('chat-dock')).toBeVisible()
  const open = await fits(page)
  expect(open).toMatchObject({ wrapper: true, page: true, done: true })
  expect(open.width).toBeLessThan(800)
  await page.keyboard.press('Control+b')
  expect(await fits(page)).toMatchObject({ wrapper: true, page: true, done: true })
  await page.setViewportSize({ width: 1024, height: 768 })
  expect(await fits(page)).toMatchObject({ wrapper: true, page: true, done: true })
})

test('the done group is collapsed behind a link and opens with it', async ({ page }) => {
  await expect(page.locator('.col[data-stage=done] .card')).toHaveCount(0)
  await page.getByTestId('show-done-group').click()
  await expect(page).toHaveURL(/stage=done/)
  await expect(page.locator('.col[data-stage=done] .card').first()).toBeVisible()
})
