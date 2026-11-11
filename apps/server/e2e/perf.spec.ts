import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// Timings need a quiet server on a production build (`next start`); the sharded fake-forge job runs 3 workers at once.
test.skip(!!process.env.E2E_FAKE_FORGE, 'perf budget runs in the plain e2e job')

/** After a click, something pending (link pending state, progress bar, skeleton) or the content must be visible within PENDING_MS, the content within CONTENT_MS. Timestamps come from a MutationObserver in the page, not from Playwright polling. */
const PENDING_MS = 100
const CONTENT_MS = 400

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const main = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const settings = (page: Page) => page.getByRole('navigation', { name: 'Settings' })

/** `content`: CSS selector plus the text its element must have (RegExp source) once the URL changed. */
type Content = { sel: string; text?: string }
type Target = { route: string; from: string; click: (page: Page) => Promise<void>; content: Content }
const h1 = (text: string): Content => ({ sel: 'h1.title', text: `^${text}$` })
const h2 = (text: string): Content => ({ sel: 'h2.heading', text: `^${text}$` })

/** Clicks run from `from`, so each one is a client-side navigation like a user's. */
const targets: Target[] = [
  { route: '/requests', from: '/', click: (p) => main(p).getByRole('link', { name: /^Requests/ }).click(), content: h1('Requests') },
  { route: '/inbox', from: '/', click: (p) => main(p).getByRole('link', { name: /^Inbox/ }).click(), content: h1('Inbox') },
  { route: '/', from: '/requests', click: (p) => main(p).getByRole('link', { name: /^Workflow/ }).click(), content: h1('Workflow') },
  { route: '/team', from: '/', click: (p) => main(p).getByRole('link', { name: 'Team' }).click(), content: h1('Team') },
  { route: '/releases', from: '/', click: (p) => main(p).getByRole('link', { name: 'Releases' }).click(), content: h1('Releases') },
  { route: '/knowledge', from: '/', click: (p) => main(p).getByRole('link', { name: 'Knowledge' }).click(), content: h1('Knowledge') },
  { route: '/insights', from: '/', click: (p) => main(p).getByRole('link', { name: 'Insights' }).click(), content: h1('Insights') },
  { route: '/runs', from: '/', click: (p) => main(p).getByRole('link', { name: 'Runs' }).click(), content: h1('Runs') },
  { route: '/settings/profile', from: '/', click: (p) => p.getByRole('link', { name: 'Settings', exact: true }).click(), content: h2('Profile') },
  ...(
    [
      ['General', '/settings/workspace'],
      ['People', '/settings/bauherren'],
      ['Products', '/settings/products'],
      ['AI usage', '/settings/usage'],
      ['Models & budget', '/settings/models'],
      ['Workflow', '/settings/workflow'],
      ['Templates', '/settings/templates'],
      ['Connections', '/settings/connections'],
      ['Knowledge', '/settings/knowledge'],
      ['Health', '/settings/health'],
      ['API keys', '/settings/api-key'],
      ['Audit', '/settings/audit'],
    ] as const
  ).map(([link, route]): Target => ({ route, from: '/settings/profile', click: (p) => settings(p).getByRole('link', { name: link, exact: true }).click(), content: h2(link) })),
  { route: '/tickets/[id]', from: '/', click: (p) => p.locator('[data-testid=workflow] a[href^="/tickets/"]').first().click(), content: { sel: '[data-testid=action-bar]' } },
  { route: '/runs/[id]', from: '/runs', click: (p) => p.locator('main a[href^="/runs/"]').first().click(), content: { sel: 'h1.title', text: '^#\\d+ ' } },
]

/** Records (ms since the last click) when something pending first shows and when the content shows on the new URL. */
const observe = (c: Content) => {
  const w = window as unknown as { __perf: { t0: number | null; pending: number | null; content: number | null } }
  const perf = (w.__perf = { t0: null as number | null, pending: null, content: null })
  const path = location.pathname + location.search
  document.addEventListener('click', () => (perf.t0 = performance.now()), { capture: true })
  const re = c.text ? new RegExp(c.text) : null
  const check = () => {
    if (perf.t0 === null) return
    const now = performance.now() - perf.t0
    const arrived = location.pathname + location.search !== path && [...document.querySelectorAll(c.sel)].some((e) => !re || re.test(e.textContent ?? ''))
    if (arrived && perf.content === null) perf.content = now
    if (perf.pending === null && (arrived || document.querySelector('[aria-busy="true"], [data-testid=nav-progress][data-active=true]'))) perf.pending = now
  }
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'data-active'], characterData: true })
}

for (const t of targets) {
  test(`${t.route}: pending within ${PENDING_MS} ms, content within ${CONTENT_MS} ms`, async ({ page }) => {
    await signIn(page)
    if (t.route === '/knowledge') await page.goto('/knowledge') // the first view of a Workspace builds its index (about a second, once)
    await page.goto(t.from)
    await page.waitForLoadState('networkidle')
    test.skip(t.route === '/knowledge' && !(await main(page).getByRole('link', { name: 'Knowledge' }).count()), 'the seed has no Knowledge repo')
    await page.evaluate(observe, t.content)
    await t.click(page)
    await page.waitForFunction(() => (window as unknown as { __perf: { content: number | null } }).__perf.content !== null, undefined, { timeout: 15_000 })
    const { pending, content } = await page.evaluate(() => (window as unknown as { __perf: { pending: number; content: number } }).__perf)
    console.log(`PERF ${t.route} pending=${Math.round(pending)} content=${Math.round(content)}`)
    expect(pending, 'pending feedback').toBeLessThan(PENDING_MS)
    expect(content, 'content').toBeLessThan(CONTENT_MS)
  })
}
