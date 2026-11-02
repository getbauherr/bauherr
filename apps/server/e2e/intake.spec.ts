import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

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
