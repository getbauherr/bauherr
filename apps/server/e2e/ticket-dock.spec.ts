import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { give, PNG } from './paste'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE, 'needs the server started with CHAT_FAKE=1 (set CHAT_FAKE=1 here)')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const shots = process.env.SHOTS_DIR

const login = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
}
const open = async (page: Page, title: string) => {
  await page.locator('.card', { hasText: title }).first().getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(title)
}
const dock = (page: Page) => page.getByTestId('chat-dock')
const composer = (page: Page) => dock(page).getByRole('textbox', { name: 'Message the factory' })
const badge = async (page: Page) => Number((await page.getByRole('navigation', { name: 'Main' }).getByLabel(/need you/).textContent()) ?? 0)
const shoot = async (page: Page, name: string, viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) => {
  if (!shots) return
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${shots}/${name}-${scheme}-${vp.width}x${vp.height}.png` })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(viewports[0]!)
}

// Own seeded Ticket (#41, Triage hold with one question).
test('the Inbox card opens the Ticket thread in the dock; the recommended answer resolves the question and the Inbox count drops', async ({ page }) => {
  await login(page)
  await page.goto('/inbox')
  const before = await badge(page)
  const card = page.locator('article[data-decision]').filter({ hasText: 'Name the export file' })
  await card.getByRole('button', { name: 'Answer questions' }).click()
  await expect(dock(page)).toBeVisible()
  const q = dock(page).getByRole('region', { name: 'Answer questions' })
  await expect(q).toContainText('Which file name', { timeout: 30_000 })
  await expect(q.getByRole('button', { name: 'export.csv (recommended)' })).toBeVisible()
  await dock(page).getByTestId('thread-list-button').click()
  await expect(page.getByTestId('thread-list')).toContainText('#41 Name the export file')
  await page.keyboard.press('Escape')
  await q.getByRole('button', { name: 'export.csv (recommended)' }).click()
  await expect(q).toContainText('D1 export.csv. Next: the plan is being written, then you can approve it.', { timeout: 60_000 })
  await expect.poll(() => badge(page)).toBe(before - 1)
  await expect(card).toHaveCount(0)
  await page.goto('/inbox')
  await expect(card).toHaveCount(0)
})

test('a Ticket page at 1440 px has the facts in a right column and one Steps row per Run; narrow, the column stacks below', async ({ page }) => {
  await login(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page, 'Export invoices as CSV')
  const facts = page.getByTestId('ticket-facts')
  const steps = page.getByTestId('ticket-steps')
  await expect(page.getByTestId('ticket-status')).toContainText(/In progress|Queued|Waiting/)
  const [f, s] = [(await facts.boundingBox())!, (await steps.boundingBox())!]
  expect(f.x).toBeGreaterThanOrEqual(s.x + s.width)
  const runs = Number(await facts.locator('dt', { hasText: /^Runs$/ }).locator('xpath=following-sibling::dd').textContent())
  expect(runs).toBeGreaterThan(0)
  await expect(steps.getByTestId('step-run')).toHaveCount(runs)
  await expect(page.locator('details')).toHaveCount(1)
  expect(s.height).toBeLessThan(900)
  await page.setViewportSize({ width: 390, height: 844 })
  const [f2, s2] = [(await facts.boundingBox())!, (await steps.boundingBox())!]
  expect(f2.y).toBeGreaterThanOrEqual(s2.y + s2.height)
  await shoot(page, 'ticket-3runs', [{ width: 1440, height: 900 }, { width: 390, height: 844 }])
})

test('a comment with a pasted image is posted through the dock and the image link serves without login', async ({ page, playwright }) => {
  await login(page)
  await open(page, 'Review the retry policy')
  await page.getByTestId('action-bar').getByRole('button', { name: 'Comment' }).click()
  await expect(dock(page)).toBeVisible()
  await expect(composer(page)).toHaveValue('/comment ', { timeout: 30_000 })
  await expect(dock(page).getByTestId('context-chip')).toContainText('Review the retry policy')
  await give(composer(page), 'paste', { name: 'pasted.png', type: 'image/png', base64: PNG })
  await expect(dock(page).getByTestId('attachment').locator('img')).toBeVisible()
  await composer(page).fill('/comment The total is off')
  await shoot(page, 'dock-comment-draft', [{ width: 1440, height: 900 }, { width: 390, height: 844 }])
  await composer(page).press('Enter')
  const note = dock(page).getByTestId('local-note')
  await expect(note).toContainText('Posted to the issue.')
  await expect(composer(page)).toHaveValue('')
  await expect(dock(page).getByTestId('attachment')).toHaveCount(0)
  const image = note.getByRole('img')
  await expect(image).toHaveCount(1)
  const src = (await image.getAttribute('src'))!
  expect(src).toMatch(/\/m\/\d+\/[\w-]+\.png$/)
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  const anon = await playwright.request.newContext({ baseURL: process.env.BASE_URL })
  expect((await anon.get(src)).status()).toBe(200)
  await anon.dispose()
  await shoot(page, 'dock-comment-posted')
  await composer(page).fill('/comment ')
  await composer(page).press('Enter')
  await expect(note).toContainText('write a comment or add an image')
})

test('the model drafts a comment, the person confirms it on a card, and a declined one posts nothing', async ({ page }) => {
  await login(page)
  await open(page, 'Review the retry policy')
  await page.getByTestId('action-bar').getByRole('button', { name: 'Comment' }).click()
  await composer(page).fill('comment #27: Please add a test for the total')
  await composer(page).press('Enter')
  const card = dock(page).getByTestId('confirm-card')
  await expect(card).toContainText('Comment on #27 Review the retry policy', { timeout: 30_000 })
  await expect(card).toContainText('Please add a test for the total')
  await card.getByRole('button', { name: 'Approve' }).click()
  await expect(dock(page).getByTestId('confirm-outcome')).toHaveText('Done.', { timeout: 30_000 })
  await composer(page).fill('comment #27: A second one')
  await composer(page).press('Enter')
  const second = dock(page).getByTestId('confirm-card').last()
  await expect(second).toContainText('A second one', { timeout: 30_000 })
  await second.getByRole('button', { name: 'Decline' }).click()
  await second.getByRole('button', { name: 'Decline' }).click()
  await expect(second).toContainText('Declined')
})

test('the open question of a Ticket is on its page as one compact entry and its card sits in the Ticket thread (screenshots)', async ({ page }) => {
  test.skip(!shots, 'screenshots only')
  await login(page)
  await open(page, 'Add a dark theme to the dashboard')
  await expect(page.getByTestId('action-bar').getByRole('button', { name: 'Comment' })).toBeVisible()
  await shoot(page, 'ticket-open-question')
  await page.getByTestId('action-bar').getByRole('button', { name: /^Answer \d questions?$/ }).click()
  await expect(dock(page).getByRole('region', { name: 'Answer questions' })).toContainText('Follow the system setting', { timeout: 30_000 })
  await shoot(page, 'dock-ticket-thread-question')
})
