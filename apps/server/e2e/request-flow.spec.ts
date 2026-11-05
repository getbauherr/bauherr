import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

test('a draft saved before logout is reopened from Requests, finished, sent and commented on from its Request page', async ({ page }) => {
  test.setTimeout(90_000)
  const signIn = async () => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('header.topbar')).toBeVisible()
  }
  const say = async (text: string, reply: string) => {
    await page.getByLabel(/Describe your request|Your answer/).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('[data-role=assistant]').last()).toHaveText(reply)
  }
  const shots = process.env.SHOTS_DIR
  const shoot = async (name: string) => {
    if (!shots) return
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/${name}-${scheme}-${w}x${h}.png`, fullPage: true })
      }
    }
  }
  const title = `The flow check is broken ${Date.now()}`

  await signIn()
  await page.goto('/requests/new')
  await page.getByLabel('Product').click()
  await page.getByRole('option', { name: 'Acme Web' }).click()
  await say(title, 'Who is affected, and since when?')
  await page.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await signIn()

  await page.goto('/requests')
  const draft = page.locator('tbody tr').filter({ hasText: title })
  await expect(draft).toContainText('Draft')
  await shoot('flow-requests-draft')
  await draft.getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/requests\/new\?session=\d+/)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[data-role=user]').first()).toHaveText(title)
  await expect(page.locator('[data-role=assistant]').last()).toHaveText('Who is affected, and since when?')
  await say('Finance, last week', 'How should it work once it is fixed?')
  await say('Totals should match', 'Anything to add before I send this?')
  await page.getByRole('button', { name: 'Submit request' }).click()
  const number = /Request #(\d+) sent/.exec(await page.getByRole('status').innerText())![1]

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
  await page.getByRole('textbox', { name: 'Comment' }).fill('Flow comment')
  await page.getByRole('button', { name: 'Post comment' }).click()
  await expect(page.getByText('Posted to the forge.')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('request-comment').filter({ hasText: 'Flow comment' }).last()).toContainText(`#${number}`)
  await shoot('flow-request-page')
})
