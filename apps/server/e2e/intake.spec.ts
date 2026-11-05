import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { give, PNG } from './paste'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

const signIn = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
}
const say = async (page: Page, text: string, reply: string | RegExp) => {
  await page.getByLabel(/Describe your request|Your answer/).fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.locator('[data-role=assistant]').last()).toHaveText(reply)
}

test('a request with several problems ends in one confirmed list and one Ticket per problem', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  await expect(page.getByRole('link', { name: 'New request' })).toHaveCount(0)
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })
  await say(page, 'The invoice total is wrong and also the export is slow', /I will create 3 separate tickets/)
  await expect(page.getByRole('complementary', { name: 'Draft' }).getByRole('listitem')).toContainText(['The invoice total is wrong', 'The export is slow', 'The login page is confusing'], { timeout: 10_000 })
  await page.getByRole('button', { name: 'Create 3 tickets' }).click()
  await expect(page.getByRole('status')).toContainText(/Requests #\d+, #\d+, #\d+ sent/)
})

test('a screenshot pasted into New request is sent with the request and shown in the created Ticket', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })
  await say(page, 'The shot check is broken', 'Who is affected, and since when?')
  await give(page.getByLabel(/Describe your request|Your answer/), 'paste', { name: 'pasted-shot.png', type: 'image/png', base64: PNG })
  await expect(page.getByText('pasted-shot.png')).toBeVisible()
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  const bar = page.getByRole('region', { name: 'Next step' })
  await expect(page.locator('[data-slot=button][data-variant=default]').filter({ hasNotText: 'Send' })).toHaveCount(1)
  await bar.getByRole('button', { name: 'Submit request' }).click()
  const number = /Request #(\d+) sent/.exec(await page.getByRole('status').innerText())![1]
  const api = async (path: string, data?: object) => (await (data ? page.request.post(`/api/${path}`, { data }) : page.request.get(`/api/${path}`))).json()
  const product = (await api('products?where[name][equals]=Acme%20Web&depth=0')).docs[0]
  // The poller is not running here: sync the created Ticket the way it would.
  const ticket = (await api(`tickets?where[number][equals]=${number}&where[product][equals]=${product.id}&depth=0`)).docs[0] ?? (await api('tickets', { title: 'The shot check is broken', externalId: `e2e-intake-${number}`, number: Number(number), state: 'open', stage: 'triage', product: product.id, workspace: product.workspace })).doc
  await page.goto(`/tickets/${ticket.id}`)
  await page.getByText('Details', { exact: true }).click()
  await expect(page.getByRole('img', { name: 'pasted-shot.png' })).toBeVisible()
  expect((await page.request.get((await page.getByRole('img', { name: 'pasted-shot.png' }).getAttribute('src'))!)).headers()['content-type']).toBe('image/png')
})

test('closing the tab mid-interview and coming back resumes the session, the draft and unsent text', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })
  await say(page, 'The resume check is broken', 'Who is affected, and since when?')
  await page.getByLabel('Your answer').fill('half typed answer')
  await page.reload()
  await expect(page.locator('[data-role=assistant]').last()).toHaveText('Who is affected, and since when?')
  await expect(page.getByLabel('Your answer')).toHaveValue('half typed answer')
  await page.goto('/requests/new')
  await expect(page.locator('[data-role=user]').first()).toHaveText('The resume check is broken')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText("We'll ask if anything is unclear")
})

test('a Product user describes a request, answers the questions and sends a Ticket to Triage', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()

  await page.getByRole('link', { name: /^Requests/ }).click()
  await page.getByRole('link', { name: 'New request' }).first().click()
  await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible()
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })

  const say = async (text: string, reply: string) => {
    await page.getByLabel(/Describe your request|Your answer/).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('[data-role=assistant]').last()).toHaveText(reply)
  }
  await say('The invoice total is wrong', 'Who is affected, and since when?')
  await expect(page.getByRole('button', { name: 'Submit request' })).toHaveCount(0)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add screenshot' }).click()
  await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.getByText('shot.png')).toBeVisible()
  await say('Finance, last week', 'How should it work once it is fixed?')
  await say('Totals should match', 'Anything to add before I send this?')
  await expect(page.getByRole('complementary', { name: 'Draft' })).toContainText('No rounding drift on export')

  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText("We'll ask if anything is unclear")
})

test('Discard asks in a dialog first; Keep draft leaves the draft, Discard removes it', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  const product = Number(await page.getByLabel('Product').locator('option', { hasText: 'Acme Web' }).getAttribute('value'))
  const session = (texts: string[]) =>
    page.evaluate(async ({ product, texts }) => {
      const { id } = (await (await fetch('/intake/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product }) })).json()) as { id: number }
      for (const text of texts) await (await fetch(`/intake/api/sessions/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).text()
      return id
    }, { product, texts })
  await session(['The discard check is broken'])
  const current = await session(['The totals are wrong', 'Finance, last week', 'Totals should match'])
  await page.goto(`/requests/new?session=${current}`)

  const drafts = page.getByRole('list', { name: 'Your drafts' })
  await drafts.getByRole('button', { name: 'Discard' }).click()
  const dialog = page.getByRole('dialog', { name: 'Discard this draft?' })
  await expect(dialog).toContainText('The discard check is broken')
  await dialog.getByRole('button', { name: 'Keep draft' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(drafts).toContainText('The discard check is broken')

  await drafts.getByRole('button', { name: 'Discard' }).click()
  await dialog.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByText('No open drafts.')).toBeVisible()

  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText("We'll ask if anything is unclear")
})
