import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const enter = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/')
}

const OWN_TITLE = /^Reorder (first|second)$/

const open = async (page: Page) => {
  await enter(page)
  const intake = page.getByRole('region', { name: 'Intake' })
  const links = intake.getByRole('link', { name: OWN_TITLE })
  const order = () => links.allTextContents()
  await expect(links).toHaveCount(2)
  await page.waitForLoadState('networkidle')
  const [upper, lower] = await order()
  const grip = (title: string) => intake.getByRole('button', { name: new RegExp(`^Drag #\\d+ ${title}$`) })
  return { intake, links, order, upper: upper!, lower: lower!, grip }
}

const OVER = /is over/

const hovered = async (page: Page) => (await page.getByRole('status').filter({ hasText: OVER }).textContent()) ?? ''

test('a card dragged by its handle stays moved after a reload', async ({ page }) => {
  const { links, order, upper, lower, grip } = await open(page)
  await grip(lower).hover()
  await page.mouse.down()
  const from = (await grip(lower).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y - 6, { steps: 3 })
  await expect(grip(lower)).toHaveAttribute('aria-pressed', 'true')
  const start = await hovered(page)
  const to = (await grip(upper).boundingBox())!
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 10, { steps: 12 })
  await expect(page.getByRole('status').filter({ hasText: OVER })).not.toHaveText(start)
  await page.mouse.up()
  await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toContainText(lower)
  expect(await order()).toEqual([lower, upper])
  await page.reload()
  await expect(links).toHaveCount(2)
  expect(await order()).toEqual([lower, upper])
})

test('a card sorted with the keyboard stays moved after a reload', async ({ page }) => {
  const { links, order, upper, lower, grip } = await open(page)
  await grip(lower).focus()
  await page.keyboard.press('Space')
  await expect(grip(lower)).toHaveAttribute('aria-pressed', 'true')
  const start = await hovered(page)
  await expect(async () => {
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('status').filter({ hasText: OVER })).not.toHaveText(start, { timeout: 1500 })
  }).toPass()
  await page.keyboard.press('Space')
  await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toContainText(lower)
  expect(await order()).toEqual([lower, upper])
  await page.reload()
  await expect(links).toHaveCount(2)
  expect(await order()).toEqual([lower, upper])
})

test('the menu moves a card to the top', async ({ page }) => {
  const { intake, order, upper, lower } = await open(page)
  await intake.getByRole('button', { name: new RegExp(`^Move #\\d+ ${lower}$`) }).click()
  await page.getByRole('menuitem', { name: 'Move to top' }).click()
  await expect.poll(order).toEqual([lower, upper])
})

test('a click on the card body opens the ticket', async ({ page }) => {
  const { links } = await open(page)
  await links.first().click()
  await expect(page).toHaveURL(/\/tickets\/\d+$/)
})
