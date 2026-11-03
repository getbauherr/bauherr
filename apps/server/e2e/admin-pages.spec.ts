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

test('Admin: agent key shown once, Audit, Workflow, health; no /admin link', async ({ page }) => {
  await signIn(page, email)
  await page.getByRole('button', { name: 'User menu' }).click()
  await expect(page.getByRole('link', { name: 'Open /admin' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'API key' }).click()
  await expect(page).toHaveURL(/\/settings\/api-key$/)

  const label = `e2e ${Date.now()}`
  await page.getByLabel('Label').fill(label)
  await page.getByRole('button', { name: 'Create agent key' }).click()
  const line = page.getByRole('status').filter({ hasText: 'claude mcp add' })
  await expect(line).toContainText('--header "Authorization: Bearer bha_')
  const key = /Bearer (\w+)"/.exec((await line.textContent())!)![1]!
  const list = () => page.request.post('/mcp', { headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
  expect((await list()).status()).toBe(200)

  await page.reload()
  const row = page.getByRole('row', { name: label })
  await expect(row).toContainText(key.slice(0, 8))
  await expect(page.getByText(key)).toHaveCount(0)
  await expect(page.getByText('Never give this key to an agent; it can approve gates.')).toBeVisible()
  await row.getByRole('button', { name: 'Revoke' }).click()
  await row.getByRole('button', { name: 'Confirm revoke' }).click()
  await expect(row).toContainText('revoked')
  expect((await list()).status()).toBe(401)

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
  await expect(page.getByRole('heading', { name: 'Where you are asked' })).toBeVisible()
  for (const name of ['Refine', 'Approve plan', 'Accept on staging', 'Approve production']) await expect(page.getByRole('cell', { name, exact: true })).toBeVisible()
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
  await expect(page.getByRole('button', { name: 'Create agent key' })).toBeVisible()
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
