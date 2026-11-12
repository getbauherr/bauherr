import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { give, PNG } from './paste'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

// Own Workspace (slug `rc`), own Bauherr and Product owner (seed-e2e.ts): only this spec signs in as them and it runs in one worker.
const bauherr = 'rc-bauherr@example.com'
const owner = 'rc-owner@example.com'
const shots = process.env.SHOTS_DIR && `${process.env.SHOTS_DIR}/conv2`

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE && !process.env.INTAKE_FAKE, 'needs the server started with INTAKE_FAKE=1 (set INTAKE_FAKE=1 here)')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')
test.describe.configure({ mode: 'serial' })

const signIn = async (page: Page, who: string) => {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'rc', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

/** One screenshot per scheme and size into the shots directory (nothing without `SHOTS_DIR`). */
const shoot = async (page: Page, name: string, sizes: [number, number][] = [[1440, 900], [390, 844]]) => {
  if (!shots) return
  const { width: w0, height: h0 } = page.viewportSize()!
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const [w, h] of sizes) {
      if (page.viewportSize()!.width !== w) {
        await page.setViewportSize({ width: w, height: h })
        await page.reload() // as a person at that size would see it: the composer measures itself at load
      }
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${shots}/${name}-${scheme}-${w}x${h}.png` })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  if (page.viewportSize()!.width !== w0) {
    await page.setViewportSize({ width: w0, height: h0 })
    await page.reload()
  }
}

const thread = (page: Page) => page.getByTestId('request-thread')
const panel = (page: Page) => page.getByTestId('artifact-panel')
const field = (page: Page, name: string) => panel(page).locator(`[data-field=${name}]`)
const composer = (page: Page) => page.getByRole('textbox', { name: 'Your answer' })

/** Sends a message and waits for the agent's answer to be the last message and the turn to be over. */
const say = async (page: Page, text: string, reply: string | RegExp) => {
  await expect(page.getByTestId('stop')).toHaveCount(0)
  await composer(page).fill(text)
  await composer(page).press('Enter')
  await expect(page.getByTestId('speaker').last().getByTestId('reply-text')).toContainText(reply, { timeout: 30_000 })
  await expect(page.getByTestId('stop')).toHaveCount(0, { timeout: 30_000 })
}

const stamp = Date.now() // a re-run on the same database finds its own earlier requests

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('a Bauherr drafts a request in the conversation: empty start, living card, attachments, hand edit, file, read-only history with handoff', async ({ page }) => {
  test.setTimeout(150_000)
  await signIn(page, bauherr)
  await page.getByRole('banner').getByRole('link', { name: 'New request' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  const url = page.url()

  // The page IS the conversation: rail, one partner, no dock, no card on the page behind it.
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await expect(page.locator('[data-slot=sidebar][data-state=collapsed]')).toBeVisible()
  await expect(page.getByTestId('chat-dock')).toBeHidden()
  const header = page.getByTestId('participant')
  await expect(header).toContainText('Factory assistant')
  await expect(page.getByTestId('participant-line')).toContainText('Drafts the request with you')
  await expect(page.getByTestId('empty-state')).toContainText('What should the team fix or build?')
  for (const s of ['Report a bug', 'Ask for a feature', 'Change something']) await expect(page.getByTestId('empty-state').getByRole('button', { name: s })).toBeVisible()

  // The model is one short name everywhere (the full id in a title); a Bauherr also sees the cost.
  const model = (await page.getByTestId('header-model').innerText()).trim()
  expect(model).toMatch(/^claude-[\w.-]+$/)
  await expect(page.getByTestId('model-chip')).toHaveText(model)
  await expect(page.getByTestId('header-model')).toHaveAttribute('title', /\//)
  await expect(page.getByTestId('cost-chip')).toBeVisible()

  // The empty card: every field a dashed placeholder, the Product to choose (two Products), File request off.
  await expect(panel(page)).toContainText('Request card')
  await expect(field(page, 'title')).toHaveAttribute('data-placeholder', '')
  await expect(field(page, 'problem')).toHaveAttribute('data-placeholder', '')
  await expect(field(page, 'acceptance_criteria')).toHaveAttribute('data-placeholder', '')
  await expect(page.getByTestId('file-request')).toBeDisabled()
  await expect(page.getByTestId('foot-status')).toContainText('Still needed')
  await expect(page.getByTestId('foot-next')).toContainText('Then: the team looks at it')
  await shoot(page, 'request-empty')
  await field(page, 'product').getByRole('combobox', { name: 'Product' }).click()
  await page.getByRole('option', { name: 'Rc Api' }).click()
  await expect(field(page, 'product')).toContainText('Rc Api')
  await page.getByTestId('start-bug').click()
  await expect(panel(page).getByTestId('card-kind')).toHaveText('Bug')

  // The first message: streamed, the agent's question with suggested answers (once, not repeated in the card), the card filled and the changes marked.
  await say(page, 'The export button on the invoices page does nothing', 'Who is affected, and since when?')
  await expect(page.getByTestId('empty-state')).toHaveCount(0)
  await expect(page.getByTestId('speaker').last().getByTestId('speaker-model')).toHaveText(model)
  const options = page.getByTestId('current-point')
  await expect(options).toContainText('Suggested answers')
  await expect(options).toContainText('Recommended')
  await expect(options).toContainText('Or answer in your own words below')
  await expect(options.getByRole('heading')).toHaveCount(0)
  await expect(field(page, 'title')).toContainText('The export button on the invoices page does nothing')
  await expect(field(page, 'title')).toHaveAttribute('data-changed', 'true')
  await expect(field(page, 'problem')).toHaveAttribute('data-changed', 'true')
  await expect(field(page, 'acceptance_criteria')).toHaveAttribute('data-placeholder', '')
  await expect(field(page, 'attachments')).toContainText('Waiting for a screenshot') // it is about a page: the engine asks for one
  await expect(page.getByTestId('legend')).toContainText('filled in from your last message')
  await expect(page.getByTestId('foot-status')).toContainText('a screenshot')
  await expect(page.getByTestId('file-request')).toBeDisabled()
  await expect(field(page, 'product')).not.toContainText('Rc Web') // the Product stayed
  await expect(field(page, 'product').getByRole('combobox')).toHaveCount(0) // and is fixed once the conversation has started
  await expect(page.getByTestId('cost-chip')).toContainText('tokens')
  await shoot(page, 'request-draft')

  // One click on a suggested answer sends it; only what that turn changed is marked.
  await options.getByRole('button', { name: /Everyone, since last week/ }).click()
  await expect(page.getByTestId('speaker').last().getByTestId('reply-text')).toContainText('How should it work once it is fixed?', { timeout: 30_000 })
  await expect(field(page, 'context')).toContainText('Finance team, since last week.')
  await expect(field(page, 'context')).toHaveAttribute('data-changed', 'true')
  await expect(field(page, 'problem')).not.toHaveAttribute('data-changed', 'true')
  await expect(page.getByTestId('current-point')).toHaveCount(0) // this question has no suggestions

  // A pasted screenshot goes with the next message and lands on the card; the engine is satisfied.
  await give(composer(page), 'paste', { name: 'shot.png', type: 'image/png', base64: PNG })
  await expect(page.getByTestId('attachment').locator('img')).toBeVisible()
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await expect(page.getByTestId('message-image').first()).toBeVisible()
  await expect(field(page, 'attachments').getByRole('img', { name: 'shot.png' })).toBeVisible()
  await expect(field(page, 'acceptance_criteria')).toContainText('Totals match the invoice')
  await expect(page.getByTestId('foot-status')).toHaveText('Ready to file.')
  await expect(page.getByTestId('file-request')).toBeEnabled()
  await shoot(page, 'request-ready')

  // A hand edit is kept.
  await field(page, 'title').getByRole('button', { name: 'Edit Title' }).click()
  await page.getByRole('textbox', { name: 'Title' }).fill(`Export does nothing on invoices ${stamp}`)
  await field(page, 'title').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('card-edit')).toHaveCount(0) // saved: the editor closes with the answer
  await expect(field(page, 'title')).toContainText(`Export does nothing on invoices ${stamp}`)

  // After a reload the conversation is where it was.
  await page.reload()
  await expect(thread(page).getByTestId('speaker')).toHaveCount(3)
  await expect(field(page, 'title')).toContainText(`Export does nothing on invoices ${stamp}`)

  // File request: the page becomes read-only history with the handoff, no composer, no cost.
  await page.getByTestId('file-request').click()
  await expect(page).toHaveURL(/\/requests\/\d+\?view=conversation$/)
  await expect(page.getByTestId('read-only')).toContainText('read-only history')
  await expect(composer(page)).toHaveCount(0)
  const handoff = page.getByTestId('handoff')
  await expect(handoff).toContainText('Filed as #')
  await expect(handoff).toContainText('Factory assistant')
  await expect(handoff.getByTestId('handoff-request')).toHaveAttribute('href', url.replace(/^.*\/requests/, '/requests'))
  await expect(page.getByTestId('foot-status')).toHaveText(/^Filed as #\d+\.$/)
  await expect(page.getByTestId('file-request')).toHaveCount(0)
  await expect(thread(page).getByTestId('speaker')).toHaveCount(3)
  await expect(field(page, 'title').getByRole('button')).toHaveCount(0) // nothing is editable any more
  await shoot(page, 'request-filed')

  // The request page keeps its own view and links back to the conversation; Requests lists it as sent.
  await page.goto(url.replace(/^.*\/requests/, '/requests'))
  await expect(page.getByRole('heading', { name: `Export does nothing on invoices ${stamp}` })).toBeVisible()
  await page.getByRole('link', { name: 'Open the conversation' }).click()
  await expect(page.getByTestId('handoff')).toBeVisible()
  await page.goto('/requests')
  await expect(page.getByTestId('factory-row').filter({ hasText: `Export does nothing on invoices ${stamp}` })).toHaveCount(1)
})

test('a Product owner has the same conversation: a read-only model, no cost, their own Product, a card they file', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, owner)
  await page.getByRole('banner').getByRole('link', { name: 'New request' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByTestId('conversation-shell')).toBeVisible()
  await expect(page.getByTestId('participant')).toContainText('Factory assistant')
  await expect(page.getByTestId('empty-state')).toBeVisible()

  // No factory internals: the model is a label (no choice), there is no cost chip, no dock, no helper.
  await expect(page.getByTestId('header-model')).toHaveText(/^claude-[\w.-]+$/)
  await expect(page.getByTestId('model-chip')).toHaveText(/^claude-[\w.-]+$/)
  await expect(page.getByRole('combobox', { name: /^Model/ })).toHaveCount(0)
  await expect(page.getByTestId('cost-chip')).toHaveCount(0)
  await expect(page.getByTestId('chat-dock')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toHaveCount(0)
  await expect(field(page, 'product')).toContainText('Rc Web')
  await expect(field(page, 'product').getByRole('combobox')).toHaveCount(0) // one Product: nothing to choose
  await shoot(page, 'request-po-empty')

  await say(page, `The invoice total is wrong ${stamp}`, 'Who is affected, and since when?')
  await expect(field(page, 'problem')).toContainText(`The invoice total is wrong ${stamp}`)
  await shoot(page, 'request-po-draft')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await expect(page.getByTestId('foot-status')).toHaveText('Ready to file.')
  await shoot(page, 'request-po-ready')
  await page.getByTestId('file-request').click()
  await expect(page).toHaveURL(/\/requests\/\d+\?view=conversation$/)
  await expect(page.getByTestId('handoff')).toContainText('Filed as #')
  await expect(page.getByTestId('read-only')).toBeVisible()
  await expect(page.getByTestId('handoff-request')).toBeVisible()
  await shoot(page, 'request-po-filed')

  // Their requests list shows it, and another Product's conversation is not theirs.
  await page.goto('/requests')
  await expect(page.getByTestId('factory-row').filter({ hasText: `The invoice total is wrong ${stamp}` })).toHaveCount(1)
})

test('a request with several problems is filed as one Ticket each, a draft can be discarded, and Requests continues a draft', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, bauherr)
  await page.goto('/requests/new')
  await say(page, 'The invoice total is wrong and also the export is slow', /I will create 3 separate tickets/)
  await expect(page.getByTestId('current-point').getByRole('button', { name: /Yes, create them/ })).toBeVisible()
  await expect(page.getByTestId('file-request')).toHaveText('File 3 requests')
  await expect(page.getByTestId('foot-next')).toContainText('3 Tickets')
  await page.getByTestId('file-request').click()
  await expect(page.getByTestId('handoff')).toContainText(/Filed as #\d+, #\d+, #\d+/)

  // A second draft: left, listed under Drafts, continued from there, then discarded from the menu after a question.
  await page.goto('/requests/new')
  const title = `Discard check ${Date.now()}`
  await say(page, title, 'Who is affected, and since when?')
  await page.goto('/requests')
  const draft = page.getByTestId('draft').filter({ hasText: title })
  await expect(draft).toHaveCount(1)
  await draft.getByRole('link', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(thread(page).getByTestId('speaker')).toHaveCount(1)
  await page.getByTestId('more').click()
  await page.getByTestId('discard-draft').click()
  const dialog = page.getByRole('dialog', { name: 'Discard this draft?' })
  await dialog.getByRole('button', { name: 'Keep draft' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByTestId('more').click()
  await page.getByTestId('discard-draft').click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByTestId('draft').filter({ hasText: title })).toHaveCount(0)
})

test('on a phone the card is a sheet behind a bar and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, bauherr)
  await page.goto('/requests/new')
  await say(page, 'The login page is confusing', 'Who is affected, and since when?')
  await expect(page.getByTestId('artifact-panel')).toHaveCount(0)
  expect((await composer(page).boundingBox())!.height).toBeLessThan(80) // one line, not a tall box
  const bar = page.getByTestId('artifact-bar')
  await expect(bar).toContainText('View request card')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await bar.click()
  const sheet = page.getByTestId('artifact-sheet')
  await expect(sheet).toContainText('Request card')
  await expect(sheet.locator('[data-field=title]')).toContainText('The login page is confusing')
  await expect(sheet.getByTestId('file-request')).toBeDisabled()
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await shoot(page, 'request-phone-sheet', [[390, 844]])
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})
