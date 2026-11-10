import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { give, PNG } from './paste'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE, 'needs the server started with CHAT_FAKE=1 (set CHAT_FAKE=1 here)')

const signIn = async (page: Page, who = email) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
}

const dock = (page: Page) => page.getByTestId('chat-dock')
const open = async (page: Page) => {
  await page.getByTestId('chat-open').click()
  await expect(dock(page)).toBeVisible()
}
const input = (page: Page) => dock(page).getByRole('textbox', { name: 'Message the factory' })
const send = async (page: Page, text: string) => {
  await input(page).fill(text)
  await input(page).press('Enter')
}
const lastAnswer = (page: Page) => dock(page).locator('[data-role=assistant]').last()
const shot = (page: Page, name: string) => (process.env.SHOTS_DIR ? page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` }) : undefined)

test('the dock opens with the button and with Ctrl+J, and pushes the page', async ({ page }) => {
  await signIn(page)
  await expect(dock(page)).toBeHidden()
  const before = await page.locator('main').boundingBox()
  await open(page)
  const after = await page.locator('main').boundingBox()
  if ((page.viewportSize()?.width ?? 0) >= 1024) expect(after!.width).toBeLessThan(before!.width)
  await expect(dock(page).getByTestId('welcome')).toBeVisible()
  await shot(page, 'dock-open-welcome')
  await page.keyboard.press('Control+j')
  await expect(dock(page)).toBeHidden()
  await page.keyboard.press('Control+j')
  await expect(dock(page)).toBeVisible()
})

test('the palette opens the dock with the composer focused and starts a new chat; the dock sits in the header row', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('banner').getByTestId('chat-open')).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByRole('option', { name: 'Ask the factory' }).click()
  await expect(dock(page)).toBeVisible()
  await expect(input(page)).toBeFocused({ timeout: 30_000 })
  await send(page, 'before new')
  await expect(lastAnswer(page)).toContainText('[fake] you said: before new', { timeout: 30_000 })
  await page.keyboard.press('Control+k')
  await page.getByRole('option', { name: 'New chat' }).click()
  await expect(dock(page).getByTestId('welcome')).toBeVisible()
})

test('a Ticket number shared by Products opens a chooser, a unique one the Ticket', async ({ page }) => {
  await signIn(page)
  await page.goto('/tickets/n/1')
  await expect(page.getByTestId('ticket-chooser').getByRole('link')).not.toHaveCount(1)
  await page.goto('/tickets/n/27')
  await expect(page).toHaveURL(/\/tickets\/\d+$/)
})

test('a message gets a streamed reply with a usage footer, and a status question a read receipt', async ({ page }) => {
  await signIn(page)
  await open(page)
  await send(page, 'hello factory')
  await expect(lastAnswer(page)).toContainText('[fake] you said: hello factory', { timeout: 30_000 })
  await expect(lastAnswer(page).getByTestId('usage')).toContainText('tokens')
  await send(page, 'status please')
  const receipt = dock(page).getByTestId('read-receipt')
  await expect(receipt).toBeVisible({ timeout: 30_000 })
  await expect(receipt).toContainText('ok')
  await expect(lastAnswer(page)).toContainText('[fake] tool result', { timeout: 30_000 })
  await shot(page, 'dock-answer-receipt')
})

test.describe('with the fake forge', () => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the fake forge (set E2E_FAKE_FORGE=1 here)')

  test('approving a plan in the chat asks first, runs once and refreshes the page behind', async ({ page }) => {
    await signIn(page)
    await page.goto('/tickets/n/28')
    const bar = page.getByTestId('action-bar')
    await expect(bar).toContainText('Approve plan')
    await open(page)
    await expect(dock(page).getByTestId('context-chip')).toContainText('#28')
    await send(page, 'approve #28')
    const card = dock(page).getByTestId('confirm-card')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText('Ticket')
    await expect(card).toContainText('Stage')
    await expect(card).toContainText('What happens next')
    await expect(bar).toContainText('Approve plan')
    await shot(page, 'dock-approval-pending')
    await card.getByRole('button', { name: 'Approve' }).click()
    await expect(dock(page).getByTestId('confirm-outcome')).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-state', 'approved')
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(bar).not.toContainText('Approve plan', { timeout: 30_000 })
    await shot(page, 'dock-approval-approved')
  })

  test('declining leaves the Ticket unchanged and the card cannot be answered again', async ({ page }) => {
    await signIn(page)
    await page.goto('/tickets/n/29')
    await open(page)
    await send(page, 'approve #29')
    const card = dock(page).getByTestId('confirm-card')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByRole('button', { name: 'Decline' }).click()
    await card.getByRole('textbox', { name: 'Reason (optional)' }).fill('not now')
    await card.getByRole('button', { name: 'Decline' }).click()
    await expect(card).toHaveAttribute('data-state', 'declined')
    await expect(card).toContainText('not now')
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(dock(page).getByTestId('confirm-outcome')).toContainText('not now', { timeout: 30_000 })
    await expect(lastAnswer(page)).toContainText('[fake] tool result', { timeout: 30_000 })
    await expect(lastAnswer(page).getByTestId('usage')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('action-bar')).toContainText('Approve plan')
    await expect(dock(page).getByTestId('confirm-card')).toHaveAttribute('data-state', 'declined')
  })
})

test('navigating with the dock open changes the context, and the next run is sent with the new page', async ({ page }) => {
  await signIn(page)
  await open(page)
  const chip = dock(page).getByTestId('context-chip')
  await expect(chip).not.toHaveText('...')
  const first = (await chip.textContent())!
  await page.getByRole('link', { name: 'Requests' }).first().click()
  await expect(page).toHaveURL(/\/requests/)
  await expect(chip).not.toHaveText(first)
  const label = (await chip.textContent())!
  let body = ''
  await page.route('**/api/chat/threads/*/run', async (route) => {
    const res = await route.fetch()
    body = await res.text()
    await route.fulfill({ response: res, body })
  })
  await send(page, 'where am I')
  await expect(lastAnswer(page)).toContainText('[fake] you said: where am I', { timeout: 30_000 })
  expect(JSON.parse(body.split('\n')[0]!)).toEqual({ type: 'context', label })
  await chip.click()
  await expect(page.getByTestId('context-markdown')).toBeVisible()
})

test('a pasted image becomes a thumbnail, is sent and can be enlarged', async ({ page }) => {
  await signIn(page)
  await open(page)
  await give(input(page), 'paste', { name: 'shot.png', type: 'image/png', base64: PNG })
  const thumb = dock(page).getByTestId('attachment').locator('img')
  await expect(thumb).toBeVisible({ timeout: 30_000 })
  await shot(page, 'dock-image-attached')
  await send(page, 'what is in this image')
  await expect(lastAnswer(page)).toContainText('[fake] you said: what is in this image', { timeout: 30_000 })
  await expect(dock(page).locator('[data-role=user]').last().locator('img')).toBeVisible()
  await dock(page).locator('[data-role=user]').last().getByRole('button', { name: /Enlarge/ }).click()
  await expect(page.getByRole('dialog').locator('img')).toBeVisible()
})

test('a bad answer is rated with a reason and shows on the feedback page; a reload brings the chat back', async ({ page }) => {
  const question = `rate me ${Date.now()}`
  await signIn(page)
  await open(page)
  await send(page, question)
  await expect(lastAnswer(page)).toContainText(`[fake] you said: ${question}`, { timeout: 30_000 })
  await lastAnswer(page).getByRole('button', { name: 'Bad answer' }).click()
  const pop = page.getByTestId('feedback-popover')
  await pop.getByRole('button', { name: 'Wrong', exact: true }).click()
  await pop.getByRole('textbox', { name: 'Note' }).fill('made it up')
  await shot(page, 'dock-feedback-popover')
  const rated = page.waitForResponse((r) => r.url().endsWith('/feedback') && r.status() === 204)
  await pop.getByRole('button', { name: 'Send' }).click()
  await rated
  await expect(lastAnswer(page).getByRole('button', { name: 'Bad answer' })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/settings/chat-feedback?rating=down')
  const row = page.locator('tr', { hasText: question })
  await expect(row).toContainText('Wrong')
  await expect(row).toContainText('made it up')
  await shot(page, 'feedback-page')

  await page.goto('/')
  await expect(dock(page)).toBeVisible()
  await expect(dock(page)).toContainText(question, { timeout: 30_000 })
  await expect(lastAnswer(page).getByRole('button', { name: 'Bad answer' })).toHaveAttribute('aria-pressed', 'true')
  await dock(page).getByTestId('thread-list-button').click()
  await expect(page.getByTestId('thread-list').getByTestId('thread-item').first()).toContainText(question.slice(0, 20))
  await shot(page, 'dock-thread-list')
})

test('slash commands stay local', async ({ page }) => {
  await signIn(page)
  await open(page)
  await send(page, '/help')
  await expect(dock(page).getByTestId('local-note')).toContainText('/context')
  await expect(dock(page).locator('[data-role]')).toHaveCount(0)
})

test('a second person does not see the first one\'s threads', async ({ page, browser }: { page: Page; browser: Browser }) => {
  const question = `private ${Date.now()}`
  await signIn(page)
  await open(page)
  await send(page, question)
  await expect(lastAnswer(page)).toContainText(question, { timeout: 30_000 })
  const other = await (await browser.newContext({ baseURL: new URL(page.url()).origin })).newPage()
  await signIn(other, 'chat-other@example.com')
  await open(other)
  await expect(dock(other).getByTestId('welcome')).toBeVisible()
  await dock(other).getByTestId('thread-list-button').click()
  await expect(other.getByTestId('thread-list')).not.toContainText(question.slice(0, 12))
  await other.context().close()
})
