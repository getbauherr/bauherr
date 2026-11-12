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
  await expect(page).toHaveURL(/\/requests$/)
}

test('a Product owner lands on Requests; the shell has Inbox, Requests, Profile and the user menu, nothing of the factory', async ({ page }) => {
  await signIn(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link')).toHaveText([/^Inbox/, /^Requests/, 'Profile'])
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()
  const bar = page.getByRole('banner')
  await expect(bar.getByRole('button', { name: 'New request' })).toHaveCount(0)
  await expect(page.getByTestId('chat-open')).toHaveCount(0)
  await expect(bar.getByRole('button', { name: /Search/i })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByRole('cell', { name: 'Product owner' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Acme Web' })).toBeVisible()
  await page.getByRole('button', { name: 'User menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Release notes' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('every page of the factory is a 404 for a Product owner', async ({ page }) => {
  await signIn(page)
  for (const path of ['/', '/requests/new', '/team', '/insights', '/releases', '/knowledge', '/runs', '/release-notes', '/setup', '/settings/workspace', '/settings/bauherren', '/settings/api-key', '/settings/products', '/workflow/edit']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
  }
})

/** Fetched from inside the page, so the call carries the browser's session like the app's own requests do: `page.request` sends no `Sec-Fetch-Site`/`Origin`, which Payload's cookie check treats as anonymous. */
const call = (page: Page, path: string, init?: { method: string; body?: string; headers?: Record<string, string> }) =>
  page.evaluate(async ([p, i]) => {
    const r = await fetch(p, i ?? undefined)
    return { status: r.status, body: (await r.json().catch(() => null)) as { docs?: { email: string }[] } | null }
  }, [path, init ?? null] as const)

const PATHS = ['/api/tickets', '/api/runs', '/api/connections', '/api/products', '/api/workspaces', '/api/agent_keys', '/api/chat/threads', '/api/presence', '/api/changes']

test('the API refuses a Product owner on every path the same call of a signed-in Bauherr succeeds on', async ({ page, browser, baseURL }) => {
  const control = await (await browser.newContext({ baseURL })).newPage()
  await control.goto('/login')
  await control.getByLabel('Email').fill('guard-bauherr@example.com')
  await control.getByLabel('Password').fill(password())
  await control.getByRole('button', { name: 'Sign in' }).click()
  await expect(control.getByRole('banner')).toBeVisible()
  await signIn(page)
  const anonymous = await (await browser.newContext({ baseURL })).newPage()
  await anonymous.goto('/login')

  for (const path of PATHS) {
    expect((await call(control, path)).status, `a signed-in Bauherr reads ${path}: the call carries the session`).toBe(200)
    expect([401, 403, 404], `Product owner GET ${path}`).toContain((await call(page, path)).status)
    expect([401, 403], `anonymous GET ${path}`).toContain((await call(anonymous, path)).status)
  }
  const mcp = { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }
  expect([401, 403], 'POST /mcp takes a bearer key only: a Product owner session gets nothing').toContain((await call(page, '/mcp', mcp)).status)

  // The one thing the Product owner reads is their own account, exactly like the Bauherr reads theirs.
  expect((await call(control, '/api/bauherren')).body?.docs?.map((d) => d.email)).toEqual(['guard-bauherr@example.com'])
  expect((await call(page, '/api/bauherren')).body?.docs?.map((d) => d.email)).toEqual([owner])
  expect((await call(anonymous, '/api/bauherren')).body?.docs ?? []).toEqual([])
  expect((await call(page, '/api/health')).status).toBeLessThan(600)
})
