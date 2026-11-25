import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const enter = async (page: Page, path: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'relations', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto(path)
}

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })

const RED_EDGE = /border-l-destructive/

test('a blocking ticket shows Blocks with every ticket down the chain and a red edge', async ({ page }) => {
  await enter(page, '/')
  const head = card(page, 'Chain head')
  await expect(head.getByRole('button', { name: 'Blocks 2' })).toBeVisible()
  await expect(head.locator('div').first()).toHaveClass(RED_EDGE)
  await expect(card(page, 'Chain middle').getByRole('button', { name: 'Blocks 1' })).toBeVisible()
  await expect(card(page, 'Chain tail').getByRole('button', { name: /^Blocks/ })).toHaveCount(0)
})

test('without a filter a blocking ticket sorts above an unrelated card in its stage', async ({ page }) => {
  await enter(page, '/')
  const middle = card(page, 'Chain middle')
  const stage = page.getByRole('list').filter({ has: middle })
  const titles = await stage.last().getByRole('listitem').getByRole('link').allInnerTexts()
  expect(titles.indexOf('Chain middle')).toBeLessThan(titles.indexOf('Early bystander'))
})

test('a blocked ticket shows Blocked by and is dimmed, a parent shows its parts done', async ({ page }) => {
  await enter(page, '/')
  const middle = card(page, 'Chain middle')
  await expect(middle.getByRole('button', { name: 'Blocked by 1' })).toBeVisible()
  await expect(middle.locator('[data-blocked]')).toHaveCount(1)
  await expect(card(page, 'Chain head').locator('[data-blocked]')).toHaveCount(0)
  await expect(card(page, 'Parent epic').getByRole('button', { name: '2/4 parts' })).toBeVisible()
})

test('pointing at or focusing a badge lists the tickets behind it with their stage', async ({ page }) => {
  await enter(page, '/')
  const badge = card(page, 'Chain head').getByRole('button', { name: 'Blocks 2' })
  const list = page.getByRole('tooltip').filter({ hasText: 'Waiting for this ticket' })
  await expect(list).toBeHidden()
  await badge.hover()
  await expect(list).toBeVisible()
  await expect(list).toContainText('Chain middle')
  await expect(list).toContainText('Chain tail')
  await page.mouse.move(0, 0)
  await expect(list).toBeHidden()
  await badge.focus()
  await expect(list).toBeVisible()
  await expect(badge).toHaveAccessibleDescription(/Waiting for this ticket.*#\d+ Chain middle/)
  const blocked = card(page, 'Chain middle').getByRole('button', { name: 'Blocked by 1' })
  await expect(blocked).toHaveAccessibleDescription(/This ticket waits for.*Chain head\s*Build/)
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze()
  expect(violations).toEqual([])
})

test('selecting a card outlines its related cards with a word and dims the rest, Esc ends it', async ({ page }) => {
  await enter(page, '/')
  await card(page, 'Chain middle').getByRole('button', { name: /^Related tickets of/ }).click()
  await expect(card(page, 'Chain head').getByText('Blocks this')).toBeVisible()
  await expect(card(page, 'Chain tail').getByText('Blocked by this')).toBeVisible()
  await expect(card(page, 'Parent epic').locator('[data-rel=dim]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-rel]')).toHaveCount(0)
  await expect(page.getByText('Blocks this')).toHaveCount(0)
  await card(page, 'Parent epic').getByRole('button', { name: /^Related tickets of/ }).click()
  await expect(card(page, 'Part open one').getByText('Part of')).toBeVisible()
})

test('the Blocking others and Blocked filters show only those tickets', async ({ page }) => {
  await enter(page, '/')
  const filters = page.getByRole('navigation', { name: 'Relations' })
  await filters.getByRole('link', { name: /^Blocking others/ }).click()
  await expect(page).toHaveURL(/relation=blocking$/)
  await expect(card(page, 'Chain head')).toBeVisible()
  await expect(card(page, 'Chain tail')).toHaveCount(0)
  await filters.getByRole('link', { name: /^Blocked/ }).click()
  await expect(page).toHaveURL(/relation=blocked$/)
  await expect(card(page, 'Chain tail')).toBeVisible()
  await expect(card(page, 'Chain head')).toHaveCount(0)
})

test('Group by parent shows each parent as a band with its parts done', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await enter(page, '/')
  await page.getByRole('navigation', { name: 'Relations' }).getByRole('link', { name: 'Group by parent' }).click()
  await expect(page).toHaveURL(/group=parent$/)
  const band = page.getByRole('region', { name: /Parent epic/ })
  await expect(band).toContainText('2/4 parts done')
  await expect(band.getByRole('link', { name: 'Part open one' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'No parent' }).getByRole('link', { name: 'Chain head' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('group-by-parent-1280.png'), fullPage: true })
})

test('the open badge popover heading is not covered by the card controls at 1280px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await enter(page, '/')
  await card(page, 'Chain head').getByRole('button', { name: 'Blocks 2' }).focus()
  const heading = page.getByRole('tooltip').getByText('Waiting for this ticket')
  await expect(heading).toBeVisible()
  const uncovered = await heading.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return top !== null && el.contains(top)
  })
  expect(uncovered).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('badge-popover-1280.png') })
})
