import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// Timings need a quiet server on a production build (`next start`); the sharded fake-forge job runs 3 workers at once.
test.skip(!!process.env.E2E_FAKE_FORGE, 'perf budget runs in the plain e2e job')

/** A click must show the destination's content or its skeleton within FIRST_MS, and the content within CONTENT_MS. */
const FIRST_MS = 300
const CONTENT_MS = 1500

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
}

const h = (page: Page, level: 1 | 2, name: string | RegExp) => page.getByRole('heading', { level, name })
const main = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const settings = (page: Page) => page.getByRole('navigation', { name: 'Settings' })

type Target = { route: string; from: string; click: (page: Page) => Promise<void>; content: (page: Page) => Locator; contentBudget?: false }

/** Clicks run from `from`, so each one is a client-side navigation like a user's. */
const targets: Target[] = [
  { route: '/requests', from: '/', click: (p) => main(p).getByRole('link', { name: /^Requests/ }).click(), content: (p) => h(p, 1, 'Requests') },
  { route: '/', from: '/requests', click: (p) => main(p).getByRole('link', { name: /^Tickets/ }).click(), content: (p) => h(p, 1, 'Tickets') },
  { route: '/releases', from: '/', click: (p) => main(p).getByRole('link', { name: 'Releases' }).click(), content: (p) => h(p, 1, 'Releases') },
  { route: '/knowledge', from: '/', click: (p) => main(p).getByRole('link', { name: 'Knowledge' }).click(), content: (p) => h(p, 1, 'Knowledge') },
  { route: '/settings/workspace', from: '/', click: async (p) => { await p.getByRole('button', { name: 'User menu' }).click(); await p.getByRole('menuitem', { name: 'Settings' }).click() }, content: (p) => h(p, 2, 'General') },
  ...(
    [
      ['People', '/settings/bauherren', 'People'],
      ['Products', '/settings/products', 'Products'],
      ['AI usage', '/settings/usage', 'AI usage'],
      ['Board & WIP', '/settings/workflow', 'Board & WIP'],
      ['Connections', '/settings/connections', 'Connections'],
      ['Agent keys', '/settings/api-key', 'Agent keys'],
      ['Audit', '/settings/audit', 'Audit'],
    ] as const
  ).map(([link, route, heading]): Target => ({ route, from: '/settings/workspace', click: (p) => settings(p).getByRole('link', { name: link }).click(), content: (p) => h(p, 2, heading) })),
  { route: '/tickets/[id]', from: '/', click: (p) => p.locator('.board a[href^="/tickets/"]').first().click(), content: (p) => p.getByTestId('action-bar') },
  { route: '/runs/[id]', from: '/runs', click: (p) => p.locator('main a[href^="/runs/"]').first().click(), content: (p) => h(p, 1, /^#\d+ /) },
]

for (const t of targets) {
  test(`${t.route}: feedback within ${FIRST_MS} ms, content within ${CONTENT_MS} ms`, async ({ page }) => {
    await signIn(page)
    await page.goto(t.from)
    await page.waitForLoadState('networkidle')
    if (t.route.startsWith('/settings/') && t.route !== '/settings/workspace') await settings(page).getByText('Advanced', { exact: true }).click()
    test.skip(t.route === '/knowledge' && !(await main(page).getByRole('link', { name: 'Knowledge' }).count()), 'the seed has no Knowledge repo')
    const loading = page.getByTestId('page-loading')
    const content = t.content(page)
    const start = Date.now()
    await t.click(page)
    await loading.or(content).first().waitFor({ timeout: FIRST_MS })
    const first = Date.now() - start
    await content.waitFor({ timeout: 15_000 })
    const done = Date.now() - start
    console.log(`PERF ${t.route} first=${first} content=${done}`)
    expect(first, 'first feedback').toBeLessThan(FIRST_MS)
    expect(done, 'content').toBeLessThan(CONTENT_MS)
  })
}
