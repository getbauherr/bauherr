import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.use({ viewport: { width: 1280, height: 2400 } }) // the whole column is on screen, so a drag needs no scrolling
test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

// The Board shows the owner's rank (#357): a drop or a menu move stays where it was put after a reload, whatever is blocked or live in the column.
const col = (page: Page) => page.locator('.col[data-stage=build]')
const cards = (page: Page) => col(page).locator('.card')
const titles = (page: Page) => col(page).locator('.card .ticket-title').allTextContents()
const card = (page: Page, name: string) => col(page).locator('.card', { hasText: name })
const chore = (n: number) => `Isolated chore ${n}`
// The Hotfix lane (#373) is always first; the ranked cards follow.
const lane = async (page: Page) => (await cards(page).evaluateAll((els) => els.filter((e) => !e.hasAttribute('data-lane')).map((e) => e.querySelector('.ticket-title')!.textContent!)))
const stays = async (page: Page, check: (t: string[]) => void) => {
  await expect(async () => {
    await page.reload()
    await page.waitForLoadState('networkidle') // hydrated: later clicks reach the handlers
    check(await lane(page))
  }).toPass()
}
const menu = async (page: Page, name: string, item: string) => {
  const c = card(page, name)
  await c.hover()
  await c.getByRole('button', { name: 'Card actions' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(cards(page)).not.toHaveCount(0)
})

test('a card dropped on the last card is last after a reload, although blocked cards exist', async ({ page }) => {
  const before = await lane(page)
  expect(before.length).toBeGreaterThan(5)
  const last = before[before.length - 1]
  await card(page, chore(107)).dragTo(card(page, last))
  await expect.poll(async () => (await lane(page)).at(-1)).toBe(chore(107))
  await stays(page, (t) => expect(t.at(-1)).toBe(chore(107)))
})

test('a card dropped between two cards sits between them after a reload', async ({ page }) => {
  const before = await lane(page)
  const moved = before[before.length - 1]
  const [above, below] = [before[1], before[2]]
  await card(page, moved).dragTo(card(page, below))
  await expect.poll(async () => (await lane(page)).indexOf(moved)).toBe(2)
  await stays(page, (t) => {
    expect(t[1]).toBe(above)
    expect(t[2]).toBe(moved)
    expect(t[3]).toBe(below)
  })
})

test('card menu: send to bottom, send to top, move up and down persist', async ({ page }) => {
  await menu(page, chore(108), 'Send to bottom')
  await stays(page, (t) => expect(t.at(-1)).toBe(chore(108)))
  await menu(page, chore(108), 'Move up')
  await stays(page, (t) => expect(t.at(-2)).toBe(chore(108)))
  await menu(page, chore(108), 'Move down')
  await stays(page, (t) => expect(t.at(-1)).toBe(chore(108)))
  await menu(page, chore(108), 'Send to top')
  await stays(page, (t) => expect(t[0]).toBe(chore(108)))
  const t = await lane(page)
  await menu(page, chore(108), 'Move down')
  await stays(page, (n) => expect(n.slice(0, 2)).toEqual([t[1], chore(108)]))
})

test('send to top of the queue puts the card first below the Hotfix lane; keyboard and right-click open the menu', async ({ page }) => {
  const target = card(page, chore(109))
  await target.getByRole('button', { name: 'Card actions' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await stays(page, (t) => expect(t[0]).toBe(chore(109)))
  await card(page, chore(110)).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Send to top of the queue' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(col(page).locator('.card[data-lane=hotfix]').first()).toBeVisible()
  expect(await cards(page).first().getAttribute('data-lane')).toBe('hotfix')
})

test('a 500 ms touch press opens the menu', async ({ page }) => {
  const c = card(page, chore(111))
  await c.evaluate((e) => e.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: 10, clientY: 10 })))
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeVisible()
})

test('a blocked card is ranked like any other and says why it waits', async ({ page }) => {
  const blocked = card(page, 'Blocked: add the invoice filter')
  await expect(blocked.locator('[data-status=blocked]')).toHaveAttribute('title', 'Blocked by #8')
  const toTop = (await lane(page)).at(-1) === 'Blocked: add the invoice filter'
  await menu(page, 'Blocked: add the invoice filter', toTop ? 'Send to top' : 'Send to bottom')
  await stays(page, (t) => expect(toTop ? t[0] : t.at(-1)).toBe('Blocked: add the invoice filter'))
})
