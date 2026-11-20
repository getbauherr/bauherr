import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Admin: agent key shown once, Audit, health; no /admin link', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page, email)
  await page.getByRole('button', { name: 'User menu' }).click()
  const openedMenu = page.getByRole('menu')
  await expect(openedMenu).toBeVisible()
  await expect(openedMenu.getByRole('link', { name: 'Open /admin' })).toHaveCount(0)
  await openedMenu.press('Escape')
  await expect(openedMenu).toBeHidden()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'API keys' }).click()
  await expect(page).toHaveURL(/\/settings\/api-key$/)

  const label = `e2e ${Date.now()}`
  await page.getByLabel('Label').fill(label)
  await page.getByRole('button', { name: 'Create agent key' }).click()
  const line = page.getByRole('status').filter({ hasText: 'bha_' })
  const key = /(bha_\w+)/.exec((await line.textContent())!)![1]!

  await page.reload()
  const row = page.getByRole('row', { name: label })
  await expect(row).toContainText(key.slice(0, 8))
  await expect(page.getByText(key)).toHaveCount(0)
  await expect(page.getByText('Never give this key to an agent; it can approve gates.')).toBeVisible()
  await confirmClick(
    row.getByRole('button', { name: 'Revoke' }),
    row.getByRole('button', { name: 'Confirm revoke' }),
    (t) => expect(row).toContainText('revoked', { timeout: t }),
  )
  await expect(row).toContainText('revoked')

  await page.goto('/settings/audit')
  await expect(page.getByRole('cell', { name: 'e2e:audit' })).toBeVisible()
  await page.getByLabel('Actor').fill('nobody-here')
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page.getByText('No entries match.')).toBeVisible()
  await page.getByLabel('Actor').fill('e2e-audit-actor')
  await page.getByRole('button', { name: 'Filter' }).click()
  await expect(page.getByRole('cell', { name: 'e2e:audit' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Health' }).click()
  await expect(page).toHaveURL(/\/settings\/health$/)
  await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible()
  await expect(page.getByText('Last poll, acme/web')).toBeVisible()
  await expect(page.getByText('Gateway budget')).toBeVisible()
})

test('a Bauherr gets 404 on the Admin pages, sees only their own groups and no technical settings', async ({
  page,
}) => {
  await signIn(page, 'member@example.com')
  for (const path of ['audit', 'connections', 'health', 'models'])
    expect((await page.goto(`/settings/${path}`))?.status()).toBe(404)
  await page.goto('/settings/profile')
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link')).toHaveText([
    'Profile',
    'API keys',
    'General',
    'Products',
    'People',
  ])
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('group')).toHaveCount(2)
  await page.goto('/settings/workspace')
  await expect(page.getByText('Gateway key')).toHaveCount(0)
  await expect(page.getByLabel('Name')).toHaveCount(0)
  await page.goto('/settings/api-key')
  await expect(page.getByRole('button', { name: 'Create agent key' })).toBeVisible()
})

test(
  'by default /admin redirects to /settings, also for an Admin, and /api stays up',
  { tag: '@admin-disabled' },
  async ({ page }) => {
    const anon = await page.request.get('/admin', { maxRedirects: 0 })
    expect(anon.status()).toBe(307)
    expect(new URL(anon.headers().location!, 'http://x.test').pathname).toBe('/settings')
    await signIn(page, email)
    const res = await page.request.get('/admin', { maxRedirects: 0 })
    expect(res.status()).toBe(307)
    expect(new URL(res.headers().location!, 'http://x.test').pathname).toBe('/settings')
    const fn = await page.request.post('/admin', {
      headers: { 'next-action': '0'.repeat(40), 'content-type': 'text/plain;charset=UTF-8' },
      data: '[]',
      maxRedirects: 0,
    })
    expect(fn.status()).toBe(307)
    const anonymousApiProbe = page.request
    expect((await anonymousApiProbe.get('/api/bauherren/me')).status()).toBe(200)
  },
)

test(
  'with BAUHERR_ENABLE_ADMIN=1 an Admin reaches Payload and a non-Admin does not',
  { tag: '@admin-enabled' },
  async ({ page }) => {
    await signIn(page, email)
    const res = await page.request.get('/admin')
    expect(res.status()).toBe(200)
    expect(await res.text()).toMatch(/serverFunction/)
    await page.context().clearCookies()
    await signIn(page, 'member@example.com')
    await page.goto('/admin')
    await expect(page.getByText('Unauthorized')).toBeVisible()
  },
)

test(
  'with BAUHERR_ENABLE_ADMIN=1 the /admin sign-in form (REST login) reaches the dashboard',
  { tag: '@admin-enabled' },
  async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password())
    await page.getByRole('button', { name: 'Login' }).click()
    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
  },
)

test('every Settings nav link opens a page whose heading matches, none is an anchor', async ({ page }) => {
  await signIn(page, email)
  await page.goto('/settings/profile')
  const nav = page.getByRole('navigation', { name: 'Settings' })
  const links = await nav
    .getByRole('link')
    .evaluateAll((as) => as.map((a) => [a.textContent!, a.getAttribute('href')!]))
  expect(links.length).toBeGreaterThan(5)
  for (const [label, href] of links) {
    expect(href).not.toContain('#')
    await page.goto(href)
    await expect(page.getByRole('heading', { name: label, exact: true }).first()).toBeVisible()
  }
})
