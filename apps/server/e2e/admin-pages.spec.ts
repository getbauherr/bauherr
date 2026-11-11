import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Admin: agent key shown once, Audit, Workflow, health; no /admin link', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page, email)
  await page.getByRole('button', { name: 'User menu' }).click()
  const menu = page.getByRole('menu') // assert on the opened menu: a count of 0 passes before it renders, and an Escape sent before it opens leaves it open over the page (its overlay blocks the Settings click)
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Open /admin' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'API keys' }).click()
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
  await confirmClick(row.getByRole('button', { name: 'Revoke' }), row.getByRole('button', { name: 'Confirm revoke' }), (t) => expect(row).toContainText('revoked', { timeout: t }))
  await expect(row).toContainText('revoked')
  expect((await list()).status()).toBe(401)

  await page.goto('/settings/audit')
  await page.getByLabel('Ticket', { exact: true }).fill('#2') // the touch of the seeded Ticket; other specs approve plans of their own Tickets
  await page.getByRole('button', { name: 'Filter' }).click()
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

  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Workflow', exact: true }).click()
  await expect(page).toHaveURL(/\/workflow\/edit$/)
  await expect(page.getByRole('heading', { name: 'Workflow', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByTestId('checkpoint-strip')).toContainText('Open questions')
  await expect(page.getByText('workflow.yaml')).toHaveCount(0)
  await page.goto('/settings/health')

  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Health' }).click()
  await expect(page).toHaveURL(/\/settings\/health$/)
  await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible()
  await expect(page.getByText('Last poll, acme/web')).toBeVisible()
  await expect(page.getByText('Gateway budget')).toBeVisible()
  await expect(page.getByRole('row', { name: /Expedite lead time \(last 5\)/ })).toContainText('12 min from flag to merge')
  await expect(page.getByRole('heading', { name: 'Flaky checks' })).toBeVisible()
  await expect(page.getByRole('row', { name: /^e2e 2 / })).toBeVisible()
  await expect(page.getByRole('row', { name: /^lint 1 / })).toBeVisible()
})

test('a Bauherr gets 404 on the Admin pages, sees only their own groups and no technical settings', async ({ page }) => {
  await signIn(page, 'member@example.com')
  for (const path of ['audit', 'workflow', 'connections', 'health', 'knowledge', 'chat-feedback', 'models']) expect((await page.goto(`/settings/${path}`))?.status()).toBe(404)
  expect((await page.goto('/workflow/edit'))?.status()).toBe(404)
  await page.goto('/settings/usage')
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link')).toHaveText(['Profile', 'API keys', 'Templates', 'AI usage', 'General', 'Products', 'People'])
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('group')).toHaveCount(3)
  for (const text of ['Gateway key', 'Model tiers', 'Run mode']) await expect(page.getByText(text)).toHaveCount(0)
  await expect(page.getByLabel('Budget per 30 days')).toHaveCount(0) // the budget is Admin-only: no page, no field
  await expect(page.getByRole('heading', { name: 'Budget, last 30 days' })).toBeVisible() // the numbers stay readable on AI usage
  await page.goto('/settings/workspace')
  await expect(page.getByText('Gateway key')).toHaveCount(0)
  await expect(page.getByLabel('Name')).toHaveCount(0)
  await page.goto('/runs')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/settings/api-key')
  await expect(page.getByRole('button', { name: 'Create agent key' })).toBeVisible()
})

test('by default /admin redirects to /settings, also for an Admin, and /api stays up', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_ENABLED === '1', 'runs against a server without BAUHERR_ENABLE_ADMIN')
  const anon = await page.request.get('/admin', { maxRedirects: 0 })
  expect(anon.status()).toBe(307)
  expect(new URL(anon.headers().location!, 'http://x.test').pathname).toBe('/settings')
  await signIn(page, email)
  const res = await page.request.get('/admin', { maxRedirects: 0 })
  expect(res.status()).toBe(307)
  expect(new URL(res.headers().location!, 'http://x.test').pathname).toBe('/settings')
  const fn = await page.request.post('/admin', { headers: { 'next-action': '0'.repeat(40), 'content-type': 'text/plain;charset=UTF-8' }, data: '[]', maxRedirects: 0 })
  expect(fn.status()).toBe(307)
  expect((await page.request.get('/api/bauherren/me')).status()).toBe(200)
})

// Needs a dev server started with BAUHERR_ENABLE_ADMIN=1; run with E2E_ADMIN_ENABLED=1.
test('with BAUHERR_ENABLE_ADMIN=1 an Admin reaches Payload and a non-Admin does not', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_ENABLED !== '1', 'needs a server with BAUHERR_ENABLE_ADMIN=1')
  await signIn(page, email)
  const res = await page.request.get('/admin')
  expect(res.status()).toBe(200)
  expect(await res.text()).toMatch(/serverFunction/)
  await page.context().clearCookies()
  await signIn(page, 'member@example.com')
  await page.goto('/admin')
  await expect(page.getByText('Unauthorized')).toBeVisible()
})

test('with BAUHERR_ENABLE_ADMIN=1 the /admin sign-in form (REST login) reaches the dashboard', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_ENABLED !== '1', 'needs a server with BAUHERR_ENABLE_ADMIN=1')
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Login' }).click()
  await expect(page).toHaveURL(/\/admin\/?$/)
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
})

test('the Ticket page Runs table shows Run and Duration to an Admin only and never Mode or Cost', async ({ page }) => {
  for (const [who, visible] of [['member@example.com', false], [email, true]] as const) {
    await signIn(page, who)
    await page.getByRole('link', { name: /Export invoices as CSV/ }).first().click()
    await page.getByText('Details', { exact: true }).click()
    const runs = page.getByRole('region', { name: 'Runs' })
    await expect(runs.getByRole('columnheader', { name: 'Stage' })).toBeVisible()
    for (const name of ['Run', 'Duration']) await expect(runs.getByRole('columnheader', { name, exact: true })).toHaveCount(visible ? 1 : 0)
    for (const name of ['Mode', 'Cost']) await expect(runs.getByRole('columnheader', { name })).toHaveCount(0)
    await expect(runs.getByText('$')).toHaveCount(0)
    await page.context().clearCookies()
  }
})

test('Paths that never hold a Build: saved per Product in the Checks & merging tab', async ({ page }) => {
  await signIn(page, email)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Web' }).first().click()
  await page.getByRole('link', { name: 'Checks & merging' }).click()
  await expect(page.getByRole('heading', { name: 'Paths that never hold a Build' })).toBeVisible()
  const field = page.getByLabel('Paths that never hold a Build', { exact: true })
  const glob = `e2e-${Date.now()}/**`
  await field.fill(`CHANGELOG.md\n${glob}`)
  await page.locator('form', { has: field }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(field).toHaveValue(`CHANGELOG.md\n${glob}`)
  await field.fill('has space')
  await page.locator('form', { has: field }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('One path glob per line, without spaces')).toBeVisible()
  await field.fill('')
  await page.locator('form', { has: field }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})

test('the Ticket page Repair disclosure is for an Admin only and resets counters', async ({ page }) => {
  for (const [who, visible] of [['member@example.com', false], [email, true]] as const) {
    await signIn(page, who)
    await page.getByRole('link', { name: /Export invoices as CSV/ }).first().click()
    await page.getByText('Details', { exact: true }).click()
    const repair = page.getByRole('region', { name: 'Repair' })
    await expect(repair).toHaveCount(visible ? 1 : 0)
    if (visible) {
      await repair.getByRole('button', { name: 'Repair', exact: true }).click()
      await confirmClick(repair.getByRole('button', { name: 'Reset counters' }), repair.getByRole('button', { name: 'Confirm reset counters' }), (t) => expect(repair.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: t }))
    }
    await page.context().clearCookies()
  }
})

test('every Settings nav link opens a page whose heading matches, none is an anchor', async ({ page }) => {
  await signIn(page, email)
  await page.goto('/settings/profile')
  const nav = page.getByRole('navigation', { name: 'Settings' })
  const links = await nav.getByRole('link').evaluateAll((as) => as.map((a) => [a.textContent!, a.getAttribute('href')!]))
  expect(links.length).toBeGreaterThan(5)
  for (const [label, href] of links) {
    expect(href).not.toContain('#')
    await page.goto(href)
    await expect(page.getByRole('heading', { name: label, exact: true }).first()).toBeVisible()
  }
})

test('Settings > Product > Merging: Re-detect finds the queue but not the merge_group trigger, and queue mode is refused', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the fake forge (acme/merge has a queue and a workflow without merge_group)')
  await signIn(page, email)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Merge' }).click()
  await page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Checks & merging' }).click()
  await expect(page).toHaveURL(/\?tab=checks$/)
  const merging = page.locator('#merging')
  await merging.getByRole('button', { name: 'Re-detect' }).click()
  await expect(merging.getByTestId('merge-mode')).toContainText('train')
  await expect(merging.getByTestId('merge-problems')).toContainText('no merge_group trigger')
  await merging.getByLabel('Merge mode').selectOption('queue')
  await merging.getByRole('button', { name: 'Save merge mode' }).click()
  await expect(merging.getByRole('alert').first()).toContainText('Queue mode is not ready')
})

test('AI usage: an Admin sees the page and the gateway link, a non-Admin sees the page without it', async ({ page }) => {
  for (const [who, visible] of [[email, true], ['member@example.com', false]] as const) {
    await signIn(page, who)
    await page.goto('/settings/usage')
    await expect(page.getByRole('heading', { name: 'AI usage', exact: true })).toBeVisible()
    await expect(page.getByTestId('budget-bar').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Cost per Product' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open gateway config' })).toHaveCount(visible ? 1 : 0)
    await expect(page.getByText('Open traces')).toHaveCount(visible ? 1 : 0)
    if (process.env.SHOTS_DIR && visible) await page.screenshot({ path: `${process.env.SHOTS_DIR}/usage-${page.viewportSize()!.width}.png`, fullPage: true })
    // In-page fetch: Payload accepts the session cookie only for same-origin requests. A configured gateway upstream may answer 404 itself; the hidden route answers exactly 'Not found'.
    const gw = await page.evaluate(async () => { const r = await fetch('/-/gateway/config_dump', { redirect: 'manual' }); return [r.status, await r.text()] as const })
    expect(gw[1] === 'Not found').toBe(!visible)
    await page.context().clearCookies()
  }
})
