import { expect, test } from '@playwright/test'
import { composer, dock, interview, say, shoot, signIn, startRequest } from './request-dock'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1, INTAKE_FAKE=1 and CHAT_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

test('a draft saved before logout is reopened from Requests, finished and sent in the dock, and commented on from its Request page', async ({ page }) => {
  test.setTimeout(120_000)
  const title = `The flow check is broken ${Date.now()}`
  await signIn(page, 'signout-flow@example.com') // signing out ends every session of the user, so this test has one of its own
  await startRequest(page, /^New request · /)
  if (await dock(page).getByTestId('product-card').isVisible()) {
    await dock(page).getByRole('combobox', { name: 'Product' }).click()
    await page.getByRole('option', { name: 'Acme Web' }).click()
  }
  await say(page, title, 'Who is affected, and since when?')
  await page.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL('**/login') // the sign-out action must land before the next page load, which would cancel it
  await signIn(page, 'signout-flow@example.com')

  await page.goto('/requests')
  const draft = page.getByTestId('draft').filter({ hasText: title })
  await expect(draft).toHaveCount(1)
  await draft.getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await page.getByRole('button', { name: 'Continue draft' }).click()
  await expect(dock(page).getByTestId('context-chip')).toContainText('New request · Acme Web', { timeout: 30_000 })
  await expect(dock(page).locator('[data-role=user]').first()).toHaveText(title)
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await dock(page).getByTestId('confirm-card').last().getByRole('button', { name: 'Create request' }).click()
  const number = /Request #(\d+) sent/.exec(await dock(page).getByTestId('confirm-outcome').last().innerText({ timeout: 30_000 }))![1]

  const api = async (path: string, data?: object) => (await (data ? page.request.post(`/api/${path}`, { data }) : page.request.get(`/api/${path}`))).json()
  const product = (await api('products?where[name][equals]=Acme%20Web&depth=0')).docs[0]
  // The poller is not running here: sync the created Ticket the way it would.
  const synced = (await api(`tickets?where[number][equals]=${number}&where[product][equals]=${product.id}&depth=0`)).docs[0]
  if (!synced) await api('tickets', { title, externalId: `e2e-flow-${number}`, number: Number(number), state: 'open', stage: 'triage', product: product.id, workspace: product.workspace })

  await page.goto('/requests')
  const sent = page.locator('tbody tr').filter({ hasText: title })
  await expect(sent).toContainText('Sent')
  await sent.getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/requests\/\d+$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByTestId('request-ticket')).toHaveCount(1)
  await page.getByTestId('request-ticket').getByRole('button', { name: `Comment on #${number}` }).click()
  await expect(composer(page)).toHaveValue('/comment ', { timeout: 30_000 }) // the prefill lands after the dock opens; typing before it would be overwritten
  await expect(dock(page).getByTestId('context-chip')).toContainText(title)
  await composer(page).fill('/comment Flow comment')
  await composer(page).press('Enter')
  await expect(dock(page).getByTestId('local-note')).toContainText('Posted to the issue.')
  await expect(page.getByTestId('request-comment').filter({ hasText: 'Flow comment' }).last()).toContainText(`#${number}`, { timeout: 30_000 })
  await shoot(page, 'request-page-comment')
})

