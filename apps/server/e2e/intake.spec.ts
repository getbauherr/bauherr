import { expect, test } from '@playwright/test'
import { give, PNG } from './paste'
import { email as admin } from './user'
import { composer, dock, idle, interview, lastAnswer, productChosen, say, shoot, signIn, startRequest } from './request-dock'

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1, INTAKE_FAKE=1 and CHAT_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

const member = 'intake-member@example.com' // a member of the several-Product Workspace, signed in by these tests only
const choose = async (page: import('@playwright/test').Page, name: string) => {
  const card = dock(page).getByTestId('product-card')
  await card.getByRole('combobox', { name: 'Product' }).click()
  await page.getByRole('option', { name }).click()
  await expect(card.getByRole('combobox', { name: 'Product' })).toContainText(name)
}

test('a member files a request in the dock: product card, interview, draft card, receipt, and lands on the request page', async ({ page }) => {
  await signIn(page, member)
  await startRequest(page, 'choose a product')
  await expect(dock(page).getByTestId('product-card')).toBeVisible()
  await shoot(page, 'dock-request-product')
  await choose(page, 'Acme Web')
  await expect(dock(page).getByTestId('context-chip')).toHaveText('New request · Acme Web')
  await say(page, 'The invoice total is wrong', 'Who is affected, and since when?')
  await shoot(page, 'dock-request-question')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  const card = dock(page).getByTestId('confirm-card')
  await expect(card).toContainText('Send this request', { timeout: 30_000 })
  await expect(card).toContainText('Acme Web')
  await expect(card).toContainText('The invoice total is wrong')
  await expect(card).toContainText('No rounding drift on export')
  await expect(card.getByRole('button', { name: 'Create request' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Keep editing' })).toBeVisible()
  await shoot(page, 'dock-request-draft')
  await card.getByRole('button', { name: 'Create request' }).click()
  const outcome = dock(page).getByTestId('confirm-outcome')
  await expect(outcome).toContainText(/Request #\d+ sent/, { timeout: 30_000 })
  await expect(card).toHaveAttribute('data-state', 'approved')
  await shoot(page, 'dock-request-receipt')
  await outcome.getByRole('link', { name: 'Open the request' }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByRole('heading', { name: 'The invoice total is wrong' })).toBeVisible()
  await expect(page.locator('#main').getByTestId('request-card')).toHaveAttribute('data-state', 'sent')
  await expect(dock(page)).toBeVisible()
  await shoot(page, 'request-detail-dock')
  await dock(page).getByRole('button', { name: 'Close chat' }).click()
  await expect(dock(page)).toBeHidden()
  await shoot(page, 'request-detail')
})

test('a declined draft creates nothing: the request stays a Draft and the interview goes on', async ({ page }) => {
  await signIn(page, member)
  await startRequest(page, /^New request · /)
  await productChosen(page)
  const title = `The decline check is broken ${Date.now()}`
  await interview(page, title)
  const card = dock(page).getByTestId('confirm-card').last()
  await card.getByRole('button', { name: 'Keep editing' }).click()
  await expect(card).toHaveAttribute('data-state', 'declined')
  await expect(dock(page).getByTestId('confirm-outcome').last()).toContainText('Not sent')
  await expect(card.getByRole('button')).toHaveCount(0)
  await page.goto('/requests')
  await expect(page.getByTestId('draft').filter({ hasText: title })).toHaveCount(1) // still a Draft of the person, not a sent request
  await expect(page.getByTestId('factory-row').filter({ hasText: title })).toHaveCount(0)
  await expect(page.getByTestId('chat-dock').locator('[data-role=assistant]').last()).toBeVisible()
  await idle(page)
  await composer(page).fill('One more thing: also on the export')
  await composer(page).press('Enter')
  await expect(dock(page).getByTestId('confirm-card').last()).toHaveAttribute('data-state', 'pending', { timeout: 30_000 })
})

test('a request with several problems ends in one confirmed list and one Ticket per problem', async ({ page }) => {
  await signIn(page, member)
  await startRequest(page, /^New request · /)
  await productChosen(page)
  await say(page, 'The invoice total is wrong and also the export is slow', /I will create 3 separate tickets/)
  await expect(dock(page).getByTestId('request-options').getByRole('button', { name: /Yes, create them/ })).toBeVisible()
  const card = dock(page).getByTestId('confirm-card').last()
  await expect(card).toContainText('Send these 3 requests', { timeout: 30_000 })
  await expect(card).toContainText('The invoice total is wrong')
  await expect(card).toContainText('The login page is confusing')
  await card.getByRole('button', { name: 'Create 3 tickets' }).click()
  await expect(dock(page).getByTestId('confirm-outcome').last()).toContainText(/Requests #\d+, #\d+, #\d+ sent/, { timeout: 30_000 })
})

test('a screenshot pasted into the dock is sent with the request and shown in the created Ticket', async ({ page }) => {
  await signIn(page, member)
  await startRequest(page, /^New request · /)
  await productChosen(page)
  await say(page, 'The shot check is broken', 'Who is affected, and since when?')
  await give(composer(page), 'paste', { name: 'pasted-shot.png', type: 'image/png', base64: PNG }) // mid-draft: the first message is already sent
  await expect(dock(page).getByTestId('attachment').locator('img')).toBeVisible()
  await composer(page).fill('Finance, last week')
  await composer(page).press('Enter')
  await expect(lastAnswer(page)).toContainText('How should it work once it is fixed?', { timeout: 30_000 })
  await idle(page)
  await expect(dock(page).getByRole('img', { name: 'pasted-shot.png' }).first()).toBeVisible()
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await dock(page).getByTestId('confirm-card').last().getByRole('button', { name: 'Create request' }).click()
  const number = /Request #(\d+) sent/.exec(await dock(page).getByTestId('confirm-outcome').last().innerText({ timeout: 30_000 }))?.[1]
  expect(number).toBeTruthy()
  const api = async (path: string, data?: object) => (await (data ? page.request.post(`/api/${path}`, { data }) : page.request.get(`/api/${path}`))).json()
  await signIn(page, admin)
  const product = (await api('products?where[name][equals]=Acme%20Web&depth=0')).docs[0]
  // The poller is not running here: sync the created Ticket the way it would.
  const ticket = (await api(`tickets?where[number][equals]=${number}&where[product][equals]=${product.id}&depth=0`)).docs[0] ?? (await api('tickets', { title: 'The shot check is broken', externalId: `e2e-intake-${number}`, number: Number(number), state: 'open', stage: 'triage', product: product.id, workspace: product.workspace })).doc
  await page.goto(`/tickets/${ticket.id}`)
  await page.getByText('Details', { exact: true }).click()
  await expect(page.getByRole('img', { name: 'pasted-shot.png' })).toBeVisible()
  expect((await page.request.get((await page.getByRole('img', { name: 'pasted-shot.png' }).getAttribute('src'))!)).headers()['content-type']).toBe('image/png')
})

test('after a reload the dock reopens on the same request thread with the interview so far', async ({ page }) => {
  await signIn(page, member)
  await startRequest(page, /^New request · /)
  await productChosen(page)
  await say(page, 'The resume check is broken', 'Who is affected, and since when?')
  await page.reload()
  await expect(dock(page)).toBeVisible()
  await expect(dock(page).getByTestId('context-chip')).toContainText('New request · Acme Web', { timeout: 30_000 })
  await expect(dock(page).locator('[data-role=user]').first()).toHaveText('The resume check is broken')
  await expect(lastAnswer(page)).toContainText('Who is affected, and since when?')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
})

test('/request in the dock starts request mode from any page, and a single-Product Workspace skips the product card', async ({ page }) => {
  await signIn(page, 'intake-solo@example.com')
  await page.getByTestId('chat-open').click()
  await expect(dock(page)).toBeVisible()
  await composer(page).fill('/request')
  await composer(page).press('Enter')
  await expect(dock(page).getByTestId('context-chip')).toHaveText('New request · Zeta App', { timeout: 30_000 })
  await expect(dock(page).getByTestId('product-card')).toHaveCount(0)
  await expect(dock(page).getByTestId('welcome')).toContainText('Describe what you need')
})

test('/requests/new is a real page that opens the dock in request mode; a single-Product Workspace has no product card', async ({ page }) => {
  await signIn(page, 'intake-solo@example.com')
  await page.goto('/requests/new')
  await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible()
  await expect(page.getByText('Describe what you need in the chat on the right.')).toBeVisible()
  await expect(dock(page).getByTestId('context-chip')).toHaveText('New request · Zeta App', { timeout: 30_000 })
  await expect(dock(page).getByTestId('product-card')).toHaveCount(0)
  await expect(page.getByRole('banner').getByRole('button', { name: 'New request' })).toHaveCount(0)
  await shoot(page, 'requests-new-dock')
  await dock(page).getByRole('button', { name: 'Close chat' }).click()
  await expect(dock(page)).toBeHidden()
  await shoot(page, 'requests-new')
  await page.getByRole('button', { name: 'Open the chat' }).click()
  await expect(dock(page)).toBeVisible()
})

test('Discard draft on the request page asks first; Keep draft leaves it, Discard removes it from Requests', async ({ page }) => {
  await signIn(page, member)
  await startRequest(page, /^New request · /)
  await productChosen(page)
  const title = `The discard check is broken ${Date.now()}`
  await say(page, title, 'Who is affected, and since when?')
  await page.goto('/requests')
  await page.getByTestId('draft').filter({ hasText: title }).getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await page.getByRole('button', { name: 'Discard draft' }).click()
  const dialog = page.getByRole('dialog', { name: 'Discard this draft?' })
  await expect(dialog).toContainText(title)
  await dialog.getByRole('button', { name: 'Keep draft' }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByTestId('draft').filter({ hasText: title })).toHaveCount(0)
  await expect(page.getByTestId('factory-row').filter({ hasText: title })).toHaveCount(0)
})

test('several drafts live side by side: New request starts an empty one, Continue reopens the right conversation, Discard removes one', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page, member)
  const a = `Draft A ${Date.now()}`
  const b = `Draft B ${Date.now()}`
  const begin = async (title: string) => {
    await startRequest(page, /^New request · /)
    await expect(dock(page).locator('[data-role=user]')).toHaveCount(0) // a new draft starts empty, whatever the dock showed before
    await choose(page, 'Acme Web')
    await say(page, title, 'Who is affected, and since when?')
  }
  await begin(a)
  await begin(b)
  await startRequest(page, /^New request · /)
  await expect(dock(page).locator('[data-role=user]')).toHaveCount(0)
  await expect(dock(page).getByTestId('welcome')).toContainText('Describe what you need')

  await page.goto('/requests')
  const drafts = page.getByTestId('drafts').getByTestId('draft')
  const [draftA, draftB] = [drafts.filter({ hasText: a }), drafts.filter({ hasText: b })]
  await expect(draftA).toHaveCount(1)
  await expect(draftB).toHaveCount(1)
  await expect(drafts.filter({ hasText: 'Untitled request' })).toHaveCount(0) // the empty third draft is not listed
  await shoot(page, 'requests-drafts')
  await draftA.getByRole('button', { name: 'Continue' }).click()
  await expect(dock(page).locator('[data-role=user]').first()).toHaveText(a, { timeout: 30_000 })
  await expect(dock(page).locator('[data-role=user]')).toHaveCount(1)
  await draftB.getByRole('button', { name: 'Continue' }).click()
  await expect(dock(page).locator('[data-role=user]').first()).toHaveText(b, { timeout: 30_000 })
  await expect(dock(page).locator('[data-role=user]')).toHaveCount(1)

  await draftA.getByRole('button', { name: `Discard draft: ${a}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Discard this draft?' })
  await expect(dialog).toContainText(a)
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(draftA).toHaveCount(0)
  await expect(draftB).toHaveCount(1)
})
