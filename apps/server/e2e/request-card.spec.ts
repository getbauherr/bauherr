import { expect, test, type Page } from '@playwright/test'
import { email as admin } from './user'
import { password, shoot } from './dock'

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1, INTAKE_FAKE=1 and CHAT_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

// A member of the several-Product Workspace with a workbench of their own (seed-e2e.ts); only these tests sign in as them.
const owner = 'card-owner@example.com'
const signIn = async (page: Page, who: string) => {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const panel = (page: Page) => page.getByTestId('artifact-panel')
const field = (page: Page, name: string) => panel(page).locator(`[data-field=${name}]`)
const composer = (page: Page) => page.getByRole('textbox', { name: 'Your answer' })
const say = async (page: Page, text: string, reply: string | RegExp) => {
  await expect(page.getByTestId('stop')).toHaveCount(0)
  await composer(page).fill(text)
  await composer(page).press('Enter')
  await expect(page.getByTestId('speaker').last().getByTestId('reply-text')).toContainText(reply, { timeout: 30_000 })
  await expect(page.getByTestId('stop')).toHaveCount(0, { timeout: 30_000 })
}
/** A new request in the conversation, for Acme Web (the card's Product select, several Products). */
const start = async (page: Page) => {
  await page.getByRole('banner').getByRole('link', { name: 'New request' }).click()
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await field(page, 'product').getByRole('combobox', { name: 'Product' }).click()
  await page.getByRole('option', { name: 'Acme Web' }).click()
  await expect(field(page, 'product')).toContainText('Acme Web')
}

test('the card fills from the conversation, keeps what the person edits, and an urgent bug asks for the fast lane', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, owner)
  await start(page)
  await say(page, 'The checkout has an outage', 'Who is affected, and since when?')
  await expect(panel(page).getByTestId('card-kind')).toHaveText('Bug')
  await expect(panel(page).getByTestId('card-urgent')).toBeVisible()
  await expect(field(page, 'urgent_reason')).toContainText('Nobody can work')
  await expect(field(page, 'urgency')).toContainText('asks the Bauherr for the fast lane')
  await expect(field(page, 'title')).toContainText('The checkout has an outage')
  await expect(page.getByTestId('file-request')).toBeDisabled()
  await expect(page.getByTestId('foot-status')).toContainText('Still needed')
  await field(page, 'title').getByRole('button', { name: 'Edit Title' }).click()
  await page.getByRole('textbox', { name: 'Title' }).fill('Checkout outage')
  await field(page, 'title').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('card-edit')).toHaveCount(0) // saved: the editor closes with the answer
  await expect(field(page, 'title')).toContainText('Checkout outage')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await expect(field(page, 'title')).toContainText('Checkout outage') // the next turn kept the edit
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await expect(page.getByTestId('foot-status')).toHaveText('Ready to file.')
  await expect(page.getByTestId('foot-next')).toContainText('fast lane')
  await page.getByTestId('file-request').click()
  await expect(page.getByTestId('handoff')).toContainText(/Filed as #\d+/, { timeout: 30_000 })
})

test('a question is answered in the conversation and files nothing until it is turned into a request', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, owner)
  await start(page)
  await say(page, 'Question: where do I find the export?', 'Here is the answer in plain words.')
  await expect(panel(page).getByTestId('card-kind')).toHaveText('Question')
  await expect(page.getByTestId('foot-status')).toContainText('files nothing')
  await expect(page.getByTestId('file-request')).toHaveCount(0)
  await panel(page).getByRole('button', { name: 'Turn into a request' }).click()
  await expect(panel(page).getByTestId('card-kind')).toHaveText('Feature')
  await expect(page.getByTestId('file-request')).toBeVisible()
})

test('the seeded draft opens as a conversation with its card; an edit of the card is stored and makes it ready', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, owner)
  await page.goto('/requests')
  const draft = page.getByTestId('draft').filter({ hasText: 'Checkout is down' })
  await expect(draft.getByTestId('kind-chip')).toHaveText('Bug')
  await expect(draft.getByTestId('urgent-chip')).toBeVisible()
  await expect(draft.getByTestId('draft-ready')).toContainText('Missing: what should happen instead')
  await draft.getByRole('link', { name: 'Continue' }).click()
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await expect(panel(page).getByTestId('request-card')).toHaveAttribute('data-urgency', 'urgent')
  await expect(field(page, 'title')).toContainText('Checkout is down')
  await expect(field(page, 'urgent_reason')).toContainText('since 9')
  await expect(page.getByTestId('file-request')).toBeDisabled()
  await field(page, 'acceptance_criteria').getByRole('button', { name: 'Edit Done when' }).click()
  await page.getByRole('textbox', { name: 'Done when' }).fill('Customers can pay again\nNo order is lost')
  await field(page, 'acceptance_criteria').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('card-edit')).toHaveCount(0)
  await expect(page.getByTestId('file-request')).toBeEnabled()
  await page.reload()
  await expect(field(page, 'acceptance_criteria')).toContainText('No order is lost')
  await expect(page.getByTestId('foot-status')).toHaveText('Ready to file.')
})

test('Requests has four sections with counts; ordering your own requests persists; Report a problem starts a linked Bug draft', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, owner)
  await page.goto('/requests')
  await expect(page.getByTestId('count-needs')).toHaveText('1')
  await expect(page.getByTestId('needs-row')).toContainText('Add an invoice filter')
  await expect(page.getByTestId('needs-row')).toContainText('Waiting for your answer')
  await expect(page.getByTestId('needs-row').getByRole('link', { name: 'Answer questions' })).toBeVisible()
  await expect(page.getByTestId('count-factory')).toHaveText(/^([3-9]|\d\d+)$/) // other specs' requests are in the list too
  for (const t of ['CSV export misses its total row', 'Show the due date on invoices', 'Checkout fails for every customer']) await expect(page.getByTestId('factory-row').filter({ hasText: t })).toHaveCount(1)
  const urgent = page.getByTestId('factory-row').filter({ hasText: 'Checkout fails for every customer' })
  await expect(urgent.getByTestId('request-status')).toContainText('Urgent · waiting for the Bauherr')
  await expect(urgent.getByTestId('request-status')).toContainText('waits for the Bauherr')
  await expect(urgent.getByTestId('kind-chip')).toHaveText('Bug')
  const done = page.getByTestId('done-row').filter({ hasText: 'Dark theme for the invoice page' })
  await expect(done.getByTestId('release-note')).toContainText('The invoice page follows the dark theme')
  await shoot(page, 'requests-workbench')

  const titles = () => page.getByTestId('factory-row').evaluateAll((els) => els.map((e) => e.querySelector('a')?.textContent))
  const csv = 'CSV export misses its total row'
  const due = 'Show the due date on invoices'
  const above = async () => (await titles()).indexOf(csv) < (await titles()).indexOf(due)
  const was = await above()
  await page.getByTestId('factory-row').filter({ hasText: csv }).getByRole('button', { name: /^Move down/ }).click()
  await expect.poll(above).toBe(!was)
  await page.reload()
  expect(await above()).toBe(!was) // saved, not only shown

  await page.goto('/requests?type=bug')
  await expect(page.getByTestId('factory-rows')).toContainText(csv)
  await expect(page.getByTestId('factory-rows')).not.toContainText(due)
  await expect(page.getByTestId('count-done')).toHaveText('0')

  await page.goto('/requests')
  await done.getByTestId('report-problem').click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(panel(page).getByTestId('card-kind')).toHaveText('Bug', { timeout: 30_000 })
  await expect(panel(page)).toContainText('Follow-up to #605')
})

test('an Admin sees every request with a By column and the fast lane decision first in the Inbox; the Ticket page offers "Put on the fast lane"', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/requests')
  await expect(page.getByTestId('request-filters').getByRole('link', { name: 'Mine' })).toBeVisible()
  await expect(page.getByTestId('factory-row').filter({ hasText: 'by card-owner@example.com' }).first()).toBeVisible()
  await page.getByTestId('request-filters').getByRole('link', { name: 'Mine' }).click()
  await expect(page.getByTestId('factory-row').filter({ hasText: 'Checkout fails for every customer' })).toHaveCount(0)

  await page.goto('/inbox')
  const first = page.locator('[data-decision]').first()
  await expect(first).toContainText('Fast lane for "Checkout fails for every customer"?')
  await expect(first).toContainText('Checkout is down for all customers since 9.')
  await expect(first.getByRole('button', { name: 'Put on the fast lane' })).toBeVisible()
  await shoot(page, 'inbox-fast-lane')

  await page.goto('/requests')
  await page.getByTestId('done-row').filter({ hasText: 'Dark theme for the invoice page' }).getByRole('link', { name: 'Dark theme for the invoice page' }).click()
  await expect(page.getByTestId('timeline-entry')).toContainText(['Sent', 'Being planned', 'Plan approved', 'Built', 'Ready for you to test', 'Accepted', 'Live'])
  await expect(page.getByTestId('request-card')).toHaveAttribute('data-state', 'sent')
  await shoot(page, 'request-page-timeline')

  await page.goto('/requests')
  await page.getByTestId('factory-row').filter({ hasText: 'CSV export misses its total row' }).getByRole('link', { name: /#602/ }).click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
  await expect(page.getByTestId('kind-chip')).toHaveText('Bug')
  const button = page.getByRole('button', { name: 'Put on the fast lane' })
  await expect(button).toHaveAttribute('title', 'Skips Triage and plan approval, jumps the queue. One at a time.')
  await shoot(page, 'ticket-fast-lane-button')
})

test('the sidebar highlights Workflow, not Settings, on the workflow editor', async ({ page }) => {
  await signIn(page, admin)
  await page.goto('/workflow/edit')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: /^Workflow/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: /^Settings/ })).not.toHaveAttribute('aria-current', 'page')
})
