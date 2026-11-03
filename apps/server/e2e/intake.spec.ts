import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

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
  await expect(page.locator('.msg.bauherr').last()).toHaveText(reply)
}

test('a request with several problems ends in one confirmed list and one Ticket per problem', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })
  await say(page, 'The invoice total is wrong and also the export is slow', /I will create 3 separate tickets/)
  await expect(page.getByRole('complementary', { name: 'Draft' }).getByRole('listitem')).toContainText(['The invoice total is wrong', 'The export is slow', 'The login page is confusing'], { timeout: 10_000 })
  await page.getByRole('button', { name: 'Create 3 tickets' }).click()
  await expect(page.getByRole('status')).toContainText(/Requests #\d+, #\d+, #\d+ sent/)
})

test('closing the tab mid-interview and coming back resumes the session, the draft and unsent text', async ({ page }) => {
  await signIn(page)
  await page.goto('/requests/new')
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })
  await say(page, 'The resume check is broken', 'Who is affected, and since when?')
  await page.getByLabel('Your answer').fill('half typed answer')
  await page.reload()
  await expect(page.locator('.msg.bauherr').last()).toHaveText('Who is affected, and since when?')
  await expect(page.getByLabel('Your answer')).toHaveValue('half typed answer')
  await page.goto('/requests/new')
  await expect(page.locator('.msg.you').first()).toHaveText('The resume check is broken')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText('waits in Triage')
})

test('a Product user describes a request, answers the questions and sends a Ticket to Triage', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()

  await page.getByRole('link', { name: 'New request' }).click()
  await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible()
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })

  const say = async (text: string, reply: string) => {
    await page.getByLabel(/Describe your request|Your answer/).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.msg.bauherr').last()).toHaveText(reply)
  }
  await say('The invoice total is wrong', 'Who is affected, and since when?')
  await expect(page.getByRole('button', { name: 'Submit request' })).toHaveCount(0)
  await say('Finance, last week', 'How should it work once it is fixed?')
  await say('Totals should match', 'Anything to add before I send this?')
  await expect(page.getByRole('complementary', { name: 'Draft' })).toContainText('No rounding drift on export')

  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText('waits in Triage')
})
