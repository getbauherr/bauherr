import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

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

type Content = { sel: string; text?: string }
type Target = { route: string; from: string; click: (page: Page) => Promise<void>; content: Content }
const h2 = (text: string): Content => ({ sel: 'h2.heading', text: `^${text}$` })

const targets: Target[] = [
  {
    route: '/settings/profile',
    from: '/',
    click: (p) => p.getByRole('link', { name: 'Settings', exact: true }).click(),
    content: h2('Profile'),
  },
  ...(
    [
      ['General', '/settings/workspace'],
      ['People', '/settings/bauherren'],
      ['Products', '/settings/products'],
      ['Models & budget', '/settings/models'],
      ['Connections', '/settings/connections'],
      ['Health', '/settings/health'],
      ['API keys', '/settings/api-key'],
      ['Audit', '/settings/audit'],
    ] as const
  ).map(([link, route]): Target => ({
    route,
    from: '/settings/profile',
    click: (p) => settings(p).getByRole('link', { name: link, exact: true }).click(),
    content: h2(link),
  })),
  {
    route: '/',
    from: '/settings/profile',
    click: (p) => main(p).getByRole('link', { name: 'Factory' }).click(),
    content: { sel: 'h1.title', text: '^Factory$' },
  },
]

type Perf = { t0: number | null; pending: number | null; content: number | null }

declare global {
  interface Window {
    __perf: Perf
  }
}

const reported = z.object({ pending: z.number(), content: z.number() })

const observe = (c: Content) => {
  const perf: Perf = { t0: null, pending: null, content: null }
  window.__perf = perf
  const path = location.pathname + location.search
  document.addEventListener('click', () => (perf.t0 = performance.now()), { capture: true })
  const re = c.text ? new RegExp(c.text) : null
  const check = () => {
    if (perf.t0 === null) return
    const now = performance.now() - perf.t0
    const arrived =
      location.pathname + location.search !== path &&
      [...document.querySelectorAll(c.sel)].some((e) => !re || re.test(e.textContent ?? ''))
    if (arrived && perf.content === null) perf.content = now
    if (
      perf.pending === null &&
      (arrived || document.querySelector('[aria-busy="true"], [data-testid=nav-progress][data-active=true]'))
    )
      perf.pending = now
  }
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-busy', 'data-active'],
    characterData: true,
  })
}

for (const t of targets) {
  test(`${t.route}: pending within ${PENDING_MS} ms, content within ${CONTENT_MS} ms`, async ({ page }) => {
    await signIn(page)
    await page.goto(t.from)
    await page.waitForLoadState('networkidle')
    await page.evaluate(observe, t.content)
    await t.click(page)
    await page.waitForFunction(() => window.__perf.content !== null, undefined, { timeout: 15_000 })
    const { pending, content } = reported.parse(await page.evaluate(() => window.__perf))
    console.log(`PERF ${t.route} pending=${Math.round(pending)} content=${Math.round(content)}`)
    expect(pending, 'pending feedback').toBeLessThan(PENDING_MS)
    expect(content, 'content').toBeLessThan(CONTENT_MS)
  })
}
