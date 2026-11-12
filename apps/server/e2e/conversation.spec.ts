import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

// Own Workspace (slug `conv`), own Admin and Product owner (seed-e2e.ts): the three Tickets (Docs Agent, Export the invoices, Name the export file) are answered by no other spec.
const admin = 'conv-admin@example.com'
const owner = 'conv-owner@example.com'
const shots = process.env.SHOTS_DIR && `${process.env.SHOTS_DIR}/conv`

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE, 'needs the server started with CHAT_FAKE=1 (set CHAT_FAKE=1 here)')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')
test.describe.configure({ mode: 'serial' })

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const hrefs: Record<string, string> = {}

const signIn = async (page: Page, who: string) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'conv', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const shoot = async (page: Page, name: string, scheme: 'light' | 'dark' = 'light') => {
  if (!shots) return
  await page.emulateMedia({ colorScheme: scheme })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${shots}/${name}.png` })
  await page.emulateMedia({ colorScheme: 'light' })
}

/** The Inbox card of a Ticket, "Answer questions" opens the conversation (a navigation, no in-card expansion). */
const open = async (page: Page, title: string) => {
  await page.goto('/inbox')
  const card = page.locator('article[data-decision]').filter({ hasText: title })
  await expect(card).toHaveCount(1)
  hrefs[title] = (await card.getByRole('link', { name: new RegExp(title) }).getAttribute('href'))!
  await card.getByRole('link', { name: 'Answer questions' }).click()
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await expect(page.getByTestId('refine-thread')).toContainText('Triage asked 4 questions')
}

const BODY = 'A recurring Docs Agent keeps the docs in step.\n\n## Trigger\nTo be decided.\n\n## Acceptance criteria\n- The agent opens a merge request with the doc changes'
const TYPED = `refine:${JSON.stringify({
  reply: 'After every merged MR means the agent needs a webhook. I wrote it into the Trigger section and added a Decisions section.',
  settled: [{ id: 'D2', answer: 'After every merged MR' }],
  dropped: [],
  added: [],
  ticket: { body: BODY.replace('To be decided.', 'After every merged MR.') + '\n\n## Decisions\n- Runs after every merged MR' },
  next: 'ask',
})}`

test('the owner refines a Ticket in the conversation shell: question card, checklist, living artifact, changes, send to planning', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, admin)
  await page.goto('/inbox')
  for (const t of ['Export the invoices', 'Name the export file']) hrefs[t] = (await page.locator('article[data-decision]').filter({ hasText: t }).getByRole('link', { name: new RegExp(t) }).getAttribute('href'))!
  await open(page, 'Docs Agent')
  await expect(page).toHaveURL(/\/tickets\/\d+\?view=conversation$/)

  // The page IS the conversation: the app sidebar is an icon rail, the Ticket page's action bar and blurbs are gone.
  await expect(page.locator('[data-slot=sidebar][data-state=collapsed]')).toBeVisible()
  await expect(page.getByTestId('action-bar')).toHaveCount(0)
  await expect(page.getByTestId('chat-dock')).toBeHidden()

  // Who is talking: the role as persona, the session that asked, the Factory assistant that replies, the model.
  const header = page.getByTestId('participant')
  await expect(header).toContainText('Orchestrator')
  await expect(header).toContainText('refining #1 with you')
  await expect(page.getByTestId('participant-line')).toContainText('orchestrator-conv@laptop asked')
  await expect(page.getByTestId('participant-line')).toContainText('Factory assistant replies')
  const first = page.getByTestId('speaker').first()
  await expect(first).toContainText('Orchestrator')
  await expect(first.getByTestId('speaker-executor')).toContainText('orchestrator-conv@laptop')
  await expect(first.getByRole('img', { name: /connected/ })).toBeVisible()
  await expect(first.getByRole('link', { name: /Run #\d+/ })).toBeVisible()

  // The question card (question 1 of 4, why, options with the recommended one), the checklist and the placeholders of the artifact.
  const card = page.getByTestId('current-point')
  await expect(card).toContainText('Question 1 of 4')
  await expect(card).toContainText('What should it deliver?')
  await expect(card).toContainText('Why this matters')
  await expect(card).toContainText('Recommended')
  await expect(card).toContainText('Or answer in your own words below')
  const panel = page.getByTestId('artifact-panel')
  await expect(panel).toContainText('Refined ticket')
  await expect(page.getByTestId('artifact-version')).toHaveText('v1')
  await expect(panel.getByTestId('artifact-title')).toHaveText('#1 Docs Agent')
  await expect(panel.getByTestId('points-count')).toHaveText('4 of 4 open')
  await expect(panel.locator('[data-point=D1]')).toHaveAttribute('aria-current', 'step')
  await expect(panel.locator('[data-placeholder=now]')).toContainText('Waiting for your answer: What should it deliver?')
  await expect(panel.locator('[data-placeholder=open]')).toHaveCount(3)
  await expect(panel.getByTestId('send-to-planning')).toBeDisabled()
  await expect(panel.getByTestId('foot-status')).toHaveText('Answer 4 more, or take the recommended answers.')
  await expect(panel.getByTestId('foot-next')).toContainText('Then: the Orchestrator finishes Triage')

  // An option click records at once: checklist, chip and artifact follow without a reload.
  await card.getByRole('button', { name: /A recurring Docs Agent/ }).click()
  await expect(panel.getByTestId('points-count')).toHaveText('3 of 4 open')
  await expect(panel.locator('[data-point=D1]')).toHaveAttribute('data-status', 'done')
  await expect(panel.locator('[data-point=D1] [data-testid=point-answer]')).toHaveText('A recurring Docs Agent')
  await expect(page.getByTestId('refine-thread').getByTestId('point-chip').first()).toContainText('A recurring Docs Agent')
  await expect(page.getByTestId('current-point')).toContainText('Question 2 of 4')

  // A typed answer that edits the Ticket: the changed sections are highlighted, the version goes up, and the diff lists them.
  await expect(page.getByTestId('rechecking')).toHaveCount(0) // the re-check after the click has ended: the composer sends again
  const typed = page.getByRole('textbox', { name: 'Your answer' })
  await typed.fill(TYPED)
  await typed.press('Enter')
  await expect(panel.locator('[data-point=D2]')).toHaveAttribute('data-status', 'done')
  await expect(panel.locator('[data-section=trigger]')).toHaveAttribute('data-changed', 'true')
  await expect(panel.locator('[data-section=trigger]')).toContainText('After every merged MR.')
  await expect(panel.locator('[data-section=decisions]')).toHaveAttribute('data-changed', 'true')
  await expect(panel.locator('[data-section="acceptance criteria"]')).not.toHaveAttribute('data-changed', 'true')
  await expect(page.getByTestId('artifact-version')).toContainText('v2 · edited')
  await expect(panel.getByTestId('changes-count')).toHaveText('2')
  await expect(page.getByTestId('speaker').last().getByTestId('speaker-executor')).toHaveText('Factory assistant')
  await expect(page.getByTestId('speaker').last().locator('[data-testid=point-chip][data-point=D2]')).toContainText('After every merged MR') // the chip sits under the message that settled it
  await shoot(page, 'B-1-refine')
  await shoot(page, 'B-4-dark', 'dark')

  await panel.getByTestId('changes').click()
  await expect(panel.getByTestId('artifact-diff')).toBeVisible()
  await expect(panel.getByTestId('diff-hunk')).toHaveCount(2)
  await expect(panel.getByTestId('artifact-diff')).toContainText('To be decided.')
  await panel.getByTestId('changes').click()
  await expect(panel.getByTestId('artifact-diff')).toHaveCount(0)

  // "Change" on a chip reopens only that point.
  await panel.locator('[data-point=D1]').getByRole('button', { name: 'Change' }).click()
  await expect(panel.locator('[data-point=D1]')).toHaveAttribute('data-status', 'active')
  await expect(panel.getByTestId('points-count')).toHaveText('3 of 4 open')
  await page.getByTestId('current-point').getByRole('button', { name: /A recurring Docs Agent/ }).click()
  await expect(panel.getByTestId('points-count')).toHaveText('2 of 4 open')

  // Send to planning waits until nothing is open; "Use recommended" settles the rest.
  await expect(panel.getByTestId('send-to-planning')).toBeDisabled()
  await panel.getByRole('button', { name: 'Use recommended' }).click()
  await expect(panel.getByTestId('points-count')).toHaveText('all settled')
  await expect(panel.getByTestId('send-to-planning')).toBeEnabled()
  await expect(panel.locator('[data-placeholder]')).toHaveCount(0)
  await expect(panel.getByTestId('foot-status')).toContainText('All points are settled')
  await shoot(page, 'B-2-submit')
  await panel.getByTestId('send-to-planning').click()
  await expect(page.getByTestId('refine-panel')).toHaveAttribute('data-state', 'sent')
  await expect(page).toHaveURL(/view=conversation/)
  await expect(page.getByTestId('read-only')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toHaveCount(0)
  await expect(page.getByTestId('handoff')).toBeVisible()
  await expect(panel.getByTestId('foot-next')).toContainText('Now:')
  await expect(panel.getByTestId('send-to-planning')).toHaveCount(0)
  await expect(panel.locator('[data-section=trigger]')).toContainText('After every merged MR.')

  // The Ticket no longer waits: the normal Ticket page shows, with a "Conversation" entry that opens the history in the same shell.
  await page.goto(hrefs['Docs Agent']!)
  await expect(page.getByTestId('conversation-shell')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Docs Agent')
  await page.getByTestId('open-conversation').click()
  await expect(page.getByTestId('read-only')).toBeVisible()
})

test('the Inbox card stays short and opens the shell; the info popover holds the Ticket meta, the agent card the session; the phone gets a sticky bar and a bottom sheet', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, admin)
  await page.goto('/inbox')
  const card = page.locator('article[data-decision]').filter({ hasText: 'Export the invoices' })
  await expect(card.getByTestId('refine-panel')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Answer questions' })).toHaveCount(0)
  await open(page, 'Export the invoices')

  await page.getByTestId('ticket-info').click()
  const info = page.getByTestId('ticket-info-content')
  await expect(info).toContainText('Conv App')
  await expect(info).toContainText('Runs')
  await expect(info).toContainText('Lead time')
  await expect(info.getByRole('button', { name: 'Put on the fast lane' })).toBeVisible()
  await expect(info.getByRole('button', { name: 'Comment' })).toBeVisible()
  await shoot(page, 'info-popover')
  await page.keyboard.press('Escape')

  await page.getByTestId('participant-line').click()
  const agent = page.getByTestId('agent-card')
  await expect(agent).toContainText('Orchestrator')
  await expect(agent).toContainText('orchestrator-conv@laptop')
  await expect(agent).toContainText('claude-code 2.1.0')
  await expect(agent).toContainText('Factory assistant')
  await expect(agent.getByRole('link', { name: /Run #\d+/ })).toBeVisible()
  await shoot(page, 'agent-card')
  await page.keyboard.press('Escape')

  await page.getByTestId('more').click()
  await expect(page.getByRole('menuitem', { name: /Ticket page/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 390, height: 844 })
  const bar = page.getByTestId('artifact-bar')
  await expect(bar).toContainText('4 of 4 open')
  await expect(bar).toContainText('View outcome')
  await expect(page.getByTestId('artifact-panel')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await shoot(page, 'B-5-phone-bar')
  await bar.click()
  const sheet = page.getByTestId('artifact-sheet')
  await expect(sheet).toContainText('Refined ticket')
  await expect(sheet.getByRole('button', { name: 'Use recommended' })).toBeVisible()
  await expect(sheet.getByTestId('send-to-planning')).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await shoot(page, 'B-5-phone-sheet')
})

test('the model chip chooses the model of the next turns, a pasted screenshot goes to the model, the cost chip breaks the conversation down by turn', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, admin)
  await page.goto(hrefs['Name the export file']!)
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await expect(page.getByTestId('header-model')).toHaveText('claude-sonnet-5-5')
  await expect(page.getByTestId('cost-chip')).toContainText('tokens')

  await page.getByTestId('model-chip').click()
  await page.getByRole('option', { name: /claude-opus-5-5/ }).click()
  await expect(page.getByTestId('header-model')).toHaveText('claude-opus-5-5')
  await expect(page.getByTestId('model-chip')).toContainText('claude-opus-5-5')

  const typed = page.getByRole('textbox', { name: 'Your answer' })
  await typed.fill('Just call it export.')
  await typed.press('Enter')
  await expect(page.getByTestId('speaker').last().getByTestId('speaker-model')).toHaveText('claude-opus-5-5')
  const requests = async () => (await (await page.request.get('/api/chat/fake-requests')).json()) as { model: string; text: string; images: number }[]
  await expect.poll(async () => (await requests()).filter((r) => r.text.includes('Just call it export.')).map((r) => r.model)).toEqual(['claude-opus-5-5']) // the header shows the model at once; the request is recorded when the turn runs

  // The choice is stored on the conversation: it survives a reload.
  await page.reload()
  await expect(page.getByTestId('header-model')).toHaveText('claude-opus-5-5')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Attach' }).click()
  await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByTestId('attachment').locator('img')).toBeVisible()
  await typed.fill('This is what I see.')
  await typed.press('Enter')
  await expect(page.getByTestId('message-image')).toBeVisible()
  await expect(page.getByTestId('attachment')).toHaveCount(0)
  await expect.poll(async () => (await requests()).filter((r) => r.text.includes('This is what I see.')).map((r) => r.images)).toEqual([1])

  await page.getByTestId('cost-chip').click()
  await expect(page.getByTestId('cost-turn')).toHaveCount(2)
  await expect(page.getByTestId('cost-turn').first()).toContainText('Turn 1')
  await expect(page.getByTestId('cost-total')).toBeVisible()
})

test('a Product owner still gets the reduced Ticket page and no conversation', async ({ page }) => {
  await signIn(page, owner)
  await page.goto(hrefs['Export the invoices']!)
  await expect(page.getByTestId('conversation-shell')).toHaveCount(0)
  await expect(page.getByTestId('open-conversation')).toHaveCount(0)
  const id = /\/tickets\/(\d+)/.exec(hrefs['Export the invoices']!)![1]
  const r = await page.request.post(`/api/refine/${id}/turn`, { data: { text: 'hello' } })
  expect(r.status()).toBe(403)
})
