import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const OWNER = 'po-requests@example.com'

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(OWNER)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const forgeCalls = async (page: Page): Promise<number> =>
  page.evaluate(async () => ((await (await fetch('/api/fake-forge')).json()) as { calls: number }).calls)

const rowOf = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title })

const filter = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Filter' }).getByRole('link', { name })

test('Requests lists mark, number, title, type, creator, status, created and last change', async ({ page }) => {
  await signIn(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/requests')
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Product' })).toContainText('Requests App')
  await expect(page.getByRole('columnheader')).toHaveText(['State', '#', 'Request', 'Status', 'Created', 'Last change'])
  const asked = rowOf(page, 'The factory asked me a question')
  await expect(asked.getByRole('cell').nth(1)).toHaveText(/^#\d+$/)
  await expect(asked.getByRole('link')).toHaveAttribute('href', /^\/requests\/\d+$/)
  await expect(asked).toContainText('Bug · You')
  await expect(asked).toContainText('Waiting for you')
  await expect(asked.getByRole('cell').nth(4)).toHaveText(/\d/)
  await expect(asked.locator('time')).toHaveText(/ago|just now/)
  await expect(rowOf(page, 'Plan waiting for my approval')).toContainText('Plan waiting for approval')
  await expect(rowOf(page, 'Plan waiting for my approval')).toContainText('Bug · jo')
  await expect(rowOf(page, 'Request being built')).toContainText('In progress')
  await expect(rowOf(page, 'Request just received')).toContainText('Received')
  const ready = rowOf(page, 'Change ready to try')
  await expect(ready).toContainText('Change · You')
  await expect(ready).toContainText('Ready to try')
  await page.screenshot({ path: test.info().outputPath('requests-overview.png') })
})

test('the filters show the right rows and counts', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests')
  await expect(filter(page, 'Open')).toHaveAttribute('aria-current', 'page')
  await expect(filter(page, 'Open')).toContainText('14')
  await expect(filter(page, 'Live')).toContainText('1')
  await expect(filter(page, 'Closed')).toContainText('1')
  await expect(filter(page, 'Only mine')).toContainText('3')
  await expect(rowOf(page, 'Request that went live')).toHaveCount(0)

  await filter(page, 'Live').click()
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(rowOf(page, 'Request that went live')).toContainText('Live')

  await filter(page, 'Closed').click()
  await expect(page.getByRole('row')).toHaveCount(2)
  await expect(rowOf(page, 'Request that was discarded')).toContainText('Closed: discarded')

  await filter(page, 'Only mine').click()
  await expect(page.getByRole('row')).toHaveCount(4)
  await expect(rowOf(page, 'Change ready to try')).toHaveCount(1)
  await expect(rowOf(page, 'Plan waiting for my approval')).toHaveCount(0)
})

test('a Product without requests shows how requests work and a way to start one', async ({ page }) => {
  await signIn(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/requests')
  await page.getByRole('button', { name: 'Product' }).click()
  await page.getByRole('menuitem', { name: 'Requests Empty' }).click()
  const heading = 'Tell the team what should change in Requests Empty'
  await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Flow diagram' }).locator('svg')).toBeVisible()
  const start = page.getByRole('link', { name: 'Start your first request' })
  await expect(start).toHaveAttribute('href', /^\/requests\/new\?product=\d+$/)
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('requests-first-visit.png') })
})

test('loading the page and its filters makes no call to the forge', { tag: '@fake-forge' }, async ({ page }) => {
  await signIn(page)
  const before = await forgeCalls(page)
  await page.goto('/requests')
  await filter(page, 'Live').click()
  await expect(rowOf(page, 'Request that went live')).toBeVisible()
  await filter(page, 'Only mine').click()
  await expect(rowOf(page, 'Change ready to try')).toBeVisible()
  expect(await forgeCalls(page)).toBe(before)
})
