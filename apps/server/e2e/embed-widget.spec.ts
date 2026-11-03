import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')

test('an Admin mints an embed token, the widget runs the interview from it, revoking stops it', async ({ page, baseURL }) => {
  const name = `e2e shop ${Date.now()}`
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()

  await page.goto('/settings/products')
  const product = page.locator('section', { has: page.getByRole('heading', { name: /Acme Web/ }) })
  await product.getByLabel('Name', { exact: true }).fill(name)
  await product.getByLabel('Allowed origins').fill(new URL(baseURL!).origin)
  await product.getByRole('button', { name: 'Create token' }).click()
  const tag = product.getByRole('status').filter({ hasText: 'data-token' })
  const token = /data-token="(bemb_[\w-]+)"/.exec((await tag.textContent())!)![1]!
  await page.reload()
  await expect(page.getByText(token)).toHaveCount(0)
  await expect(product.getByRole('cell', { name }).last()).toBeVisible()

  const host = await page.context().newPage()
  await host.goto(`/intake-embed-test.html?token=${token}`)
  await host.getByRole('button', { name: 'Report a problem' }).click()
  const say = async (text: string, reply: string) => {
    await host.getByPlaceholder('Describe it in one sentence').fill(text)
    await host.getByRole('button', { name: 'Send' }).click()
    await expect(host.getByRole('region', { name: 'Report a problem' }).locator('[data-role=assistant]').last()).toHaveText(reply)
  }
  await say('The invoice total is wrong', 'Who is affected, and since when?')
  await say('Finance, last week', 'How should it work once it is fixed?')
  await host.reload()
  await host.getByRole('button', { name: 'Report a problem' }).click()
  await expect(host.getByRole('region', { name: 'Report a problem' }).locator('[data-role=assistant]').last()).toHaveText('How should it work once it is fixed?')
  await say('Totals should match', 'Anything to add before I send this?')
  await host.getByRole('button', { name: 'Submit request' }).click()
  await expect(host.getByRole('status')).toContainText('your request #')

  await page.reload()
  await product.getByRole('row', { name }).getByRole('button', { name: 'Revoke' }).click()
  await product.getByRole('button', { name: 'Confirm revoke' }).click()
  const row = product.getByRole('row', { name })
  await expect(row.getByRole('cell').nth(3)).toHaveText(/\d{4}-\d\d-\d\d/)
  await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(0)
  const post = () => host.request.post('/intake/api/sessions', { headers: { authorization: `Bearer ${token}`, origin: new URL(baseURL!).origin }, data: {} })
  expect((await post()).status()).toBe(403)
  await page.reload()
  await expect(row.getByRole('cell').nth(3)).toHaveText(/\d{4}-\d\d-\d\d/)
  expect((await post()).status()).toBe(403)
})
