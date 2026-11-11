import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const owner = 'owner@example.com' // seeded: Product owner of Acme Web; only this spec signs in as this user

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(owner)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
}

test('a Product owner lands on the minimal shell: brand, Profile, user menu, one sentence', async ({ page }) => {
  await signIn(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText(['Profile'])
  await expect(page.getByRole('main').getByText('Your account is set up. The pages for your Products follow.')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Product owner' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Acme Web' })).toBeVisible()
  const bar = page.getByRole('banner')
  await expect(bar.getByRole('link', { name: 'New request' })).toHaveCount(0)
  await expect(page.getByTestId('chat-open')).toHaveCount(0)
  await expect(bar.getByRole('button', { name: /Search/i })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(0)
  await page.getByRole('button', { name: 'User menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Release notes' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('every page of the factory is a 404 for a Product owner', async ({ page }) => {
  await signIn(page)
  for (const path of ['/', '/tickets/1', '/requests', '/requests/new', '/inbox', '/team', '/insights', '/releases', '/knowledge', '/runs', '/release-notes', '/setup', '/settings/workspace', '/settings/bauherren', '/settings/api-key', '/settings/products', '/workflow/edit']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
  }
})

test('the API answers a Product owner with 401, 403 or 404 everywhere but the own account', async ({ page }) => {
  await signIn(page)
  for (const path of ['/api/tickets', '/api/runs', '/api/connections', '/api/products', '/api/workspaces', '/api/agent_keys', '/api/chat/threads', '/api/presence', '/api/changes']) {
    expect([401, 403, 404], `GET ${path}`).toContain((await page.request.get(path)).status())
  }
  expect([401, 403]).toContain((await page.request.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers: { accept: 'application/json, text/event-stream' } })).status())
  const me = (await (await page.request.get('/api/bauherren')).json()) as { docs: { email: string }[] }
  expect(me.docs.map((d) => d.email)).toEqual([owner])
  expect((await page.request.get('/api/health')).status()).toBeLessThan(600)
})
