import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const REPO = 'rel/app'

const enter = async (page: Page, title: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'relbox', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: title, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

const forge = (page: Page, number: number) =>
  page.evaluate(
    async ([repo, n]) => (await (await fetch(`/api/fake-forge?repo=${repo}&number=${n}`)).json()) as {
      blockedBy: string[]
      parent: string | null
    },
    [REPO, String(number)] as const,
  )

const forgeCalls = (page: Page) =>
  page.evaluate(async () => ((await (await fetch('/api/fake-forge')).json()) as { calls: number }).calls)

const box = (page: Page) => page.getByRole('region', { name: 'Relations' })

const GROUPED = 'the Relations box groups what a ticket is part of, waits for, blocks and relates to'

test(GROUPED, { tag: '@fake-forge' }, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await enter(page, 'Box subject')
  await expect(box(page).getByRole('heading', { name: 'Part of' })).toBeVisible()
  await expect(box(page).getByRole('heading', { name: 'Blocked by' })).toBeVisible()
  await expect(box(page).getByRole('heading', { name: 'Blocks' })).toBeVisible()
  await expect(box(page).getByRole('heading', { name: 'Relates to' })).toBeVisible()
  await expect(box(page)).toContainText('#2 Box parent')
  await expect(box(page)).toContainText('#3 Box blocker')
  await expect(box(page)).toContainText('#4 Box dependent')
  await expect(box(page)).toContainText('#5 Box peer')
  await expect(box(page).getByRole('listitem').first()).toContainText('Intake')
  await page.screenshot({ path: test.info().outputPath('relations-box-1280.png'), fullPage: true })
})

const SEARCH = 'searching finds a ticket older than the newest 200 and adds Blocked by'

test(SEARCH, { tag: '@fake-forge' }, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await enter(page, 'Box newcomer')
  await box(page).getByLabel('Relation type').selectOption({ label: 'Blocked by' })
  await box(page).getByLabel('Search tickets').fill('ancient')
  await expect(box(page).getByRole('option')).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('relations-search-1280.png'), fullPage: true })
  await box(page).getByRole('option', { name: '#9 Box ancient blocker' }).click()
  await box(page).getByRole('button', { name: '+ Add a relation' }).click()
  await expect(box(page).getByRole('listitem')).toContainText('#9 Box ancient blocker')
  expect((await forge(page, 6)).blockedBy).toEqual(['9'])
})

test('the cross removes a relation here and on the forge', { tag: '@fake-forge' }, async ({ page }) => {
  await enter(page, 'Box remover')
  expect((await forge(page, 7)).blockedBy).toEqual(['8'])
  await box(page).getByRole('button', { name: 'Remove Blocked by #8' }).click()
  await expect(box(page).getByRole('listitem')).toHaveCount(0)
  expect((await forge(page, 7)).blockedBy).toEqual([])
})

test('a ticket with an open blocker shows Blocked by next to its title', { tag: '@fake-forge' }, async ({ page }) => {
  await enter(page, 'Box subject')
  await expect(page.getByRole('main').getByText('Blocked by #3', { exact: true })).toBeVisible()
})

test('the page makes no call to the forge while it renders', { tag: '@fake-forge' }, async ({ page }) => {
  await enter(page, 'Box dependent')
  const before = await forgeCalls(page)
  await page.reload()
  await expect(box(page)).toContainText('#1 Box subject')
  expect(await forgeCalls(page)).toBe(before)
})
