import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const CONTRAST_REVIEWED: [target: RegExp, reason: string][] = [
  [/^(output|text)$/, 'Symbol-only output and SVG text: no text characters to measure'],
  [/^#loop-(verify|ship)$/, 'Label on a dashed loop line: muted ink on the page ground, 5.8:1 light, 7.1:1 dark'],
]

const scan = async (page: Page) => {
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(TAGS).exclude('nextjs-portal').analyze()
  const review = incomplete
    .filter((v) => v.id === 'color-contrast')
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !CONTRAST_REVIEWED.some(([re]) => re.test(n.target.join(' ')))) }))
    .filter((v) => v.nodes.length)
  return [...violations, ...review].map((v) => `${v.id} (${v.impact}): ${v.help}. ${v.helpUrl}\n${v.nodes.map((n) => `  ${n.target.join(' ')}\n    ${n.failureSummary?.replace(/\n/g, '\n    ')}`).join('\n')}`)
}

const setTheme = (page: Page, id: 'light' | 'dark') => page.evaluate((t) => { localStorage.setItem('bauherr-theme', t); document.documentElement.dataset.theme = t; return Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {}))) }, id)

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const linkOn = (from: string, re: RegExp) => async (page: Page) => {
  await page.goto(from)
  const hrefs = await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  const href = hrefs.find((h) => re.test(h))
  expect(href, `a link matching ${re} on ${from}`).toBeTruthy()
  return href!
}

const inFactory = (url: string) => async (page: Page) => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url: base }])
  return url
}

const inHooks = (url: string) => async (page: Page) => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'hooks', url: base }])
  return url
}

const inTickets = (title: string, query = '') => async (page: Page) => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url: base }])
  await page.goto('/inbox')
  const href = await page.getByRole('link', { name: new RegExp(title) }).first().getAttribute('href')
  expect(href, `a ticket titled ${title}`).toBeTruthy()
  return `${href}${query}`
}

const runOf = (title: string) => async (page: Page) => {
  await page.goto(await inTickets(title)(page))
  const href = await page.locator('main a[href^="/runs/"]').first().getAttribute('href')
  expect(href, 'a run link on the ticket').toBeTruthy()
  return href!
}

const signedOut: Record<string, string> = {
  '/login': '/login',
}

const redirects: Record<string, RegExp> = { '/settings': /^\/settings\/profile$/ }

type Target = string | ((page: Page) => Promise<string>)

const routes: Record<string, Target | Record<string, Target>> = {
  '/': inFactory('/'),
  '/inbox': inFactory('/inbox'),
  '/tickets/[id]': {
    'Brief card': inTickets('Brief with a decision for the tabs'),
    'Result card': inTickets('Result to read'),
    'Result tab': inTickets('Result to read', '?tab=result'),
    'Activity tab': inTickets('Result to read', '?tab=activity'),
    'question card': inTickets('Question to read'),
    'Intake': inTickets('Intake waiting for the reporter'),
  },
  '/runs/[id]': runOf('Build with reported steps'),
  '/settings': '/settings',
  '/settings/api-key': '/settings/api-key',
  '/settings/audit': '/settings/audit',
  '/settings/bauherren': '/settings/bauherren',
  '/settings/connections': {
    'without a webhook secret': '/settings/connections',
    'webhook with a delivery': inHooks('/settings/connections'),
  },
  '/settings/health': '/settings/health',
  '/settings/models': '/settings/models',
  '/settings/products': '/settings/products',
  '/settings/products/[id]': linkOn('/settings/products', /^\/settings\/products\/\d+$/),
  '/settings/products/new': '/settings/products/new',
  '/settings/profile': '/settings/profile',
  '/settings/workspace': '/settings/workspace',
}

test.describe('keyboard', () => {
  test('sign in with the keyboard only, then skip link, then a visible focus ring on every Tab stop', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/login')
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Email')).toBeFocused()
    await page.keyboard.type(email)
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('Password')).toBeFocused()
    await page.keyboard.type(password())
    await page.keyboard.press('Enter')
    await expect(page.getByRole('banner')).toBeVisible()

    await page.goto('/')
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('main#main')).toBeFocused()

    await page.goto('/settings/profile')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const stops: string[] = []
    for (let i = 0; ; i++) {
      expect(i, 'focus never wrapped: more than 200 Tab stops').toBeLessThan(200)
      await page.keyboard.press('Tab')
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        if (el.dataset.a11ySeen) return 'seen'
        el.dataset.a11ySeen = '1'
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '')
        return { ring, hidden: r.width === 0 || r.height === 0, name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}` }
      })
      if (stop === null || stop === 'seen') break
      if (!stop.hidden) expect(stop.ring, `focus indicator on ${stop.name}`).toBe(true)
      stops.push(stop.name)
    }
    expect(stops.length, 'a lap has Tab stops').toBeGreaterThan(5)
  })
})

test.describe('axe: WCAG 2.2 AA on every page, light and dark', () => {
  let session: Awaited<ReturnType<BrowserContext['storageState']>>
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    await signIn(await context.newPage())
    session = await context.storageState()
    await context.close()
  })

  for (const [route, url] of Object.entries(signedOut)) {
    test(`${route} (signed out)`, async ({ browser }) => {
      const anon = await (await browser.newContext()).newPage()
      await anon.goto(url)
      for (const t of ['light', 'dark'] as const) {
        await setTheme(anon, t)
        expect(await scan(anon), t).toEqual([])
      }
      await anon.close()
    })
  }

  type Scan = [route: string, title: string, target: Target]
  const variantsOf = (route: string, target: Record<string, Target>): Scan[] =>
    Object.entries(target).map(([name, variant]) => [route, `${route}: ${name}`, variant])
  const scans = Object.entries(routes).flatMap(([route, target]): Scan[] =>
    typeof target === 'string' || typeof target === 'function' ? [[route, route, target]] : variantsOf(route, target),
  )

  for (const [route, title, target] of scans) {
    test(title, async ({ browser }) => {
      test.setTimeout(120_000)
      const page = await (await browser.newContext({ storageState: session })).newPage()
      const url = typeof target === 'string' ? target : await target(page)
      await page.goto(url)
      await expect(page.getByRole('banner')).toBeVisible()
      const landed = new URL(page.url()).pathname
      const want = redirects[route]
      if (want) expect(landed, `${url} must redirect`).toMatch(want)
      else expect(landed, `${url} redirected: a scan must cover the page it names`).toBe(url.split('?')[0])
      await page.locator('h1').first().waitFor({ timeout: 10_000 }).catch(() => {})
      for (const t of ['light', 'dark'] as const) {
        await setTheme(page, t)
        expect(await scan(page), `${url} (${t})`).toEqual([])
      }
      await page.context().close()
    })
  }
})
