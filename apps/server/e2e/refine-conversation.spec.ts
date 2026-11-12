import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

// Own Workspace (slug `refine`) and own Admin (seed-e2e.ts): the Ticket this spec answers and sends on is seen by no other spec.
const email = 'refine-admin@example.com'
const shots = process.env.SHOTS_DIR && `${process.env.SHOTS_DIR}/refine`

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE, 'needs the server started with CHAT_FAKE=1 (set CHAT_FAKE=1 here)')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const signIn = async (page: Page) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'refine', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const shoot = async (page: Page, name: string, widths = [1280, 390]) => {
  if (!shots) return
  for (const width of widths) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${shots}/${name}-light-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}

const FREE_TEXT = `refine:${JSON.stringify({
  reply: 'Admins only means nobody else needs an audit trail, so both are settled. I also named the file after the date in the Ticket.',
  settled: [{ id: 'D2', answer: 'Admins only' }],
  dropped: [{ id: 'D3', reason: 'Only admins export, so no audit trail is needed' }],
  added: [],
  ticket: { title: 'Export invoices as a dated file', body: '## Problem\nFinance cannot get the invoices out of the portal.\n\n## Done when\n- An export button exists\n- The file is named by its date' },
  next: 'ask',
})}`

test('the owner refines a Ticket in the Inbox card: answer by option, by free text, recommended for the rest, summary, send to planning', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  await page.goto('/inbox')
  await page.waitForLoadState('networkidle')
  const card = page.locator('article[data-decision]').filter({ hasText: 'Export invoices as a file' })
  await expect(card).toHaveCount(1)
  const href = (await card.getByRole('link', { name: /Export invoices as a file/ }).getAttribute('href'))!
  await shoot(page, 'inbox-collapsed')

  // The card expands in place: no navigation, no dock.
  await page.evaluate(() => ((window as unknown as { __kept: number }).__kept = 1))
  await card.getByRole('button', { name: 'Answer questions' }).click()
  const panel = card.getByTestId('refine-panel')
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByTestId('chat-dock')).toBeHidden()
  await expect(page.locator('html')).not.toHaveAttribute('data-chat', 'open')

  // Who speaks: the strip, and Triage's first message with role, session with presence, model, time and a link to its Run.
  await expect(panel.getByTestId('refine-strip')).toContainText('Factory assistant')
  await expect(panel.getByTestId('refine-strip')).toContainText('Your answers go to Triage')
  const first = panel.getByTestId('speaker').first()
  await expect(first).toContainText('Triage')
  await expect(first).toContainText('session orchestrator-refine@laptop')
  await expect(first.getByRole('img', { name: /connected/ })).toBeVisible()
  await expect(first).toContainText('claude-sonnet-4-5')
  await expect(first.getByRole('link', { name: /Run #\d+/ })).toBeVisible()

  const points = panel.getByTestId('open-points')
  await expect(points).toContainText('5 of 5 open')
  await expect(points.locator('[data-point=D1]')).toHaveAttribute('aria-current', 'step')

  // "Why" answers from the stored reason, without a model call.
  await panel.getByTestId('current-point').getByRole('button', { name: 'Why does this matter?' }).click()
  const last = panel.getByTestId('refine-thread').locator('[data-role=assistant]').last()
  await expect(last).toContainText('Finance opens the file in Excel')
  await expect(last.getByTestId('speaker-model')).toHaveText('no model call')

  // An option click records at once; the open points follow without a reload.
  await panel.getByTestId('current-point').getByRole('button', { name: /CSV/ }).click()
  await expect(points.locator('[data-point=D1]')).toHaveAttribute('data-status', 'answered')
  await expect(points.locator('[data-point=D1] [data-testid=point-answer]')).toHaveText('CSV')
  await expect(points).toContainText('4 of 5 open')
  await expect(panel.getByTestId('current-point')).toContainText('Who may export')

  // One free-text message settles one point and makes another pointless; the Ticket text edit waits for the summary.
  await panel.getByRole('textbox', { name: 'Your answer' }).fill(FREE_TEXT)
  await panel.getByRole('textbox', { name: 'Your answer' }).press('Enter')
  await expect(points.locator('[data-point=D2]')).toHaveAttribute('data-status', 'answered')
  await expect(points.locator('[data-point=D3]')).toHaveAttribute('data-status', 'dropped')
  await expect(points).toContainText('2 of 5 open')
  const reply = panel.getByTestId('refine-thread').locator('[data-role=assistant]').last()
  await expect(reply).toContainText('both are settled')
  await expect(reply.getByTestId('speaker-executor')).toHaveText('Factory assistant')
  await expect(reply.getByTestId('speaker-model')).toHaveText('fake-refine')
  await expect(panel.getByTestId('current-point')).toContainText('Include archived invoices')
  await shoot(page, 'inbox-expanded')

  // Typed text never reached the helper: no helper answer, no helper thread of that text.
  await expect(panel).not.toContainText('[fake] you said')
  const threads = JSON.stringify(await (await page.request.get('/api/chat/threads')).json())
  expect(threads).not.toContain('Admins only')
  expect(threads).not.toContain('refine:')

  // The rest in one step, then the summary.
  await panel.getByRole('button', { name: 'Use the recommended answers for the rest' }).click()
  const summary = panel.getByTestId('refine-summary')
  await expect(summary).toBeVisible()
  await expect(points).toContainText('0 of 5 open')
  await expect(summary).toContainText('The file is named by its date')
  await expect(summary).toContainText('Title: Export invoices as a dated file')
  await expect(summary).toContainText('No longer needed'.toLowerCase())
  await shoot(page, 'summary')

  await summary.getByRole('button', { name: 'Keep refining' }).click()
  await expect(summary).toBeHidden()
  await panel.getByRole('button', { name: 'Review the summary' }).click()
  await expect(summary).toBeVisible()

  await summary.getByRole('button', { name: 'Send to planning' }).click()
  await expect(card).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1)

  // After sending: read-only history on the Ticket page, the Ticket has left refinement.
  await page.goto(href)
  const sent = page.getByTestId('refine-panel')
  await expect(sent).toHaveAttribute('data-state', 'sent')
  await expect(sent.getByTestId('refine-strip')).toContainText('read-only')
  await expect(sent.getByRole('textbox', { name: 'Your answer' })).toHaveCount(0)
  await expect(sent.getByTestId('speaker').first()).toContainText('Triage')
  await expect(page.getByTestId('action-bar').getByRole('link', { name: /^Answer/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Export invoices as a dated file')
  await shoot(page, 'ticket-sent')
  await page.goto('/inbox')
  await expect(page.locator('article[data-decision]').filter({ hasText: 'Export invoices' })).toHaveCount(0)
})
