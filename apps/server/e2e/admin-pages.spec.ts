import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
}

test('Admin: API key shown once, Audit, Workflow, health; no /admin link', async ({ page }) => {
  await signIn(page, email)
  await page.locator('header.topbar').locator('summary', { hasText: email.slice(0, 2).toUpperCase() }).click()
  await expect(page.getByRole('link', { name: 'Open /admin' })).toHaveCount(0)
  await page.getByRole('link', { name: 'API key' }).click()
  await expect(page).toHaveURL(/\/settings\/api-key$/)

  if (await page.getByRole('button', { name: 'Revoke key' }).isVisible()) {
    await page.getByRole('button', { name: 'Revoke key' }).click()
    await page.getByRole('button', { name: 'Confirm revoke' }).click()
  }
  await page.getByRole('button', { name: 'Create key' }).click()
  const line = page.getByRole('status').filter({ hasText: 'claude mcp add' })
  await expect(line).toContainText('--header "Authorization: Bearer ')
  const key = /Bearer (\w+)"/.exec((await line.textContent())!)![1]!
  const mcp = await page.request.post('/mcp', { headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  expect(mcp.status()).toBe(200)

  await page.reload()
  await expect(page.getByText('A key is active')).toBeVisible()
  await expect(page.getByText(key)).toHaveCount(0)
  await page.getByRole('button', { name: 'Rotate key' }).click()
  await page.getByRole('button', { name: 'Confirm rotate' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'claude mcp add' })).not.toContainText(key)
  const old = await page.request.post('/mcp', { headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  expect(old.status()).toBe(401)

  await page.goto('/settings/audit')
  await expect(page.getByRole('cell', { name: 'approve:plan' })).toBeVisible()
  await page.getByRole('link', { name: 'Tool calls' }).click()
  await expect(page.getByRole('cell', { name: 'run_checks' })).toBeVisible()
  await page.getByLabel('Ticket', { exact: true }).fill('#999')
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page.getByText('No entries match.')).toBeVisible()
  await page.getByLabel('Ticket', { exact: true }).fill('acme/web#x')
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Enter #12 or repo#12.' })).toBeVisible()
  await page.getByLabel('Ticket', { exact: true }).fill('acme/web#2')
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page.getByRole('link', { name: 'acme/web#2' }).first()).toBeVisible()

  await page.getByRole('link', { name: 'Workflow' }).click()
  await expect(page.getByRole('cell', { name: 'build', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Acme Web' })).toBeVisible()

  await page.getByRole('link', { name: 'Workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Factory health' })).toBeVisible()
  await expect(page.getByText('Last poll, acme/web')).toBeVisible()
  await expect(page.getByText('Gateway budget')).toBeVisible()
})

test('a Bauherr gets 404 on Audit and Workflow and no admin nav', async ({ page }) => {
  await signIn(page, 'member@example.com')
  for (const path of ['audit', 'workflow']) expect((await page.goto(`/settings/${path}`))?.status()).toBe(404)
  await page.goto('/settings/workspace')
  await expect(page.getByRole('link', { name: 'Audit' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Factory health' })).toHaveCount(0)
  await page.goto('/settings/api-key')
  await expect(page.getByRole('button', { name: 'Create key' })).toBeVisible()
})

// Needs a dev server started with BAUHERR_DISABLE_ADMIN=1; run with E2E_ADMIN_DISABLED=1.
test('with BAUHERR_DISABLE_ADMIN=1 /admin and its server functions answer 404, /api stays up', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_DISABLED !== '1', 'needs a server with BAUHERR_DISABLE_ADMIN=1')
  await signIn(page, email)
  const res = await page.request.get('/admin')
  expect(res.status()).toBe(404)
  const id = /([0-9a-f]{40,})\\?",\\?"bound\\?":null,\\?"name\\?":\\?"serverFunction/.exec(await res.text())?.[1]
  expect(id, 'server function id in the /admin layout').toBeTruthy()
  const fn = await page.request.post('/admin', { headers: { 'next-action': id!, 'content-type': 'text/plain;charset=UTF-8' }, data: '[]' })
  expect(fn.status()).toBe(404)
  expect((await page.request.get('/api/bauherren/me')).status()).toBe(200)
})
