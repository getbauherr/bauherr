import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { conversationTargets, requestTargets } from './conversation-page'
import { retroTargets } from './retro-targets'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const CONTRAST_REVIEWED: [target: RegExp, reason: string][] = [
  [/^(output|text)$/, 'Symbol-only output and SVG text: no text characters to measure'],
  [/^#loop-(verify|ship)$/, 'Label on a dashed loop line: muted ink on the page ground, 5.8:1 light, 7.1:1 dark'],
]

type AxeNode = { target: unknown[]; failureSummary?: string }

const describeNode = (n: AxeNode) => `  ${n.target.join(' ')}\n    ${n.failureSummary?.replace(/\n/g, '\n    ')}`

const scan = async (page: Page) => {
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(TAGS).exclude('nextjs-portal').analyze()
  const review = incomplete
    .filter((v) => v.id === 'color-contrast')
    .map((v) => ({
      ...v,
      nodes: v.nodes.filter((n) => !CONTRAST_REVIEWED.some(([re]) => re.test(n.target.join(' ')))),
    }))
    .filter((v) => v.nodes.length)
  return [...violations, ...review].map(
    (v) => `${v.id} (${v.impact}): ${v.help}. ${v.helpUrl}\n${v.nodes.map(describeNode).join('\n')}`,
  )
}

const setTheme = (page: Page, id: 'light' | 'dark') =>
  page.evaluate(async (t) => {
    localStorage.setItem('bauherr-theme', t)
    document.documentElement.dataset.theme = t
    const finite = (a: Animation) => Number.isFinite(a.effect?.getComputedTiming().endTime)
    const unfinished = () => document.getAnimations().filter((a) => finite(a) && a.playState !== 'finished')
    for (const end = Date.now() + 20_000; unfinished().length && Date.now() < end; )
      await new Promise((r) => setTimeout(r, 50))
    const stuck = unfinished().map((a) => `${a.playState} ${(a.effect as KeyframeEffect).target?.className}`)
    if (stuck.length) throw new Error(`animations unfinished after 20s: ${stuck.join(' || ')}`)
  }, id)

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

const inWorkspace = (slug: string, url: string) => async (page: Page) => {
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: slug, url: base }])
  return url
}

const inFactory = (url: string) => inWorkspace('factory', url)

const inRecord = (url: string) => inWorkspace('record', url)

const inInsights = (url: string) => inWorkspace('insights', url)

const insightsTicket = async (page: Page) => {
  await inInsights('/insights')(page)
  return linkOn('/insights', /^\/tickets\/\d+$/)(page)
}

const insightsMemory = async (page: Page) => {
  await inInsights('/memory/statements')(page)
  return linkOn('/memory/statements', /^\/memory\/\d+$/)(page)
}

const memoryOne = async (page: Page) => {
  await inRecord('/memory/statements')(page)
  return linkOn('/memory/statements', /^\/memory\/\d+$/)(page)
}

const memoryRun = async (page: Page) => {
  await inRecord('/memory')(page)
  await page.goto('/memory/statements')
  await page.getByRole('link', { name: 'Say what changed in the handoff.' }).click()
  const href = await page.locator('main a[href^="/runs/"]').first().getAttribute('href')
  expect(href, 'a run link on the memory').toBeTruthy()
  return href!
}

const withHoldStrip = (url: string) => async (page: Page) => {
  await inFactory(url)(page)
  await page.goto(url)
  const strip = page.getByRole('region', { name: 'Holding up work' })
  await expect(strip).toContainText('session is connected')
  await expect(strip.getByRole('link', { name: 'Connect a session' }).first()).toBeVisible()
  return url
}

const inHooks = (url: string) => inWorkspace('hooks', url)

const inboxAt = (width: number) => async (page: Page) => {
  await page.setViewportSize({ width, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return inFactory('/inbox')(page)
}

const inTickets =
  (title: string, query = '') =>
  async (page: Page) => {
    const base = process.env.BASE_URL ?? 'http://localhost:3000'
    await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url: base }])
    await page.goto('/inbox')
    const href = await page
      .getByRole('link', { name: new RegExp(title) })
      .first()
      .getAttribute('href')
    expect(href, `a ticket titled ${title}`).toBeTruthy()
    return `${href}${query}`
  }

const runOf = (title: string) => async (page: Page) => {
  await page.goto(await inTickets(title)(page))
  const href = await page.locator('main a[href^="/runs/"]').last().getAttribute('href')
  expect(href, 'a run link on the ticket').toBeTruthy()
  return href!
}

const signedOut: Record<string, string> = {
  '/login': '/login',
}

const redirects: Record<string, RegExp> = { '/settings': /^\/settings\/profile$/ }

const connectOf =
  (product: string, path = '/connect') =>
  async (page: Page) => {
    const base = process.env.BASE_URL ?? 'http://localhost:3000'
    await page.context().addCookies([{ name: 'bauherr-ws', value: 'connect', url: base }])
    await page.goto('/settings/products')
    const href = await page.getByRole('link', { name: product, exact: true }).getAttribute('href')
    return `${href}${path}`
  }

type Target = string | ((page: Page) => Promise<string>)

const routes: Record<string, Target | Record<string, Target>> = {
  '/': {
    Factory: inFactory('/'),
    'cannot-run line': withHoldStrip('/'),
  },
  ...{ ...conversationTargets, ...requestTargets },
  '/inbox': { desktop: inboxAt(1280), 'at 390 px': inboxAt(390) },
  '/insights': {
    'with time and cost': inInsights('/insights'),
    'nothing done in the range': inRecord('/insights'),
  },
  '/memory': inRecord('/memory'),
  '/memory/statements': inRecord('/memory/statements'),
  '/memory/new': inRecord('/memory/new'),
  ...retroTargets,
  '/memory/[id]': {
    'with a ticket': memoryOne,
    'with the cost of coming back': insightsMemory,
  },
  '/tickets/[id]': {
    'Brief card': inTickets('Brief with a decision for the tabs'),
    'Brief card with earlier answers': inTickets('Large export needs earlier answers'),
    'Result card': inTickets('Result to read'),
    'Result tab': inTickets('Result to read', '?tab=result'),
    'Activity tab': inTickets('Result to read', '?tab=activity'),
    'question card': inTickets('Question to read'),
    'build in progress with the way back': inTickets('Build with reported steps'),
    'deploy that did not finish': inTickets('Deploy that did not finish'),
    'verify rounds used up': inTickets('Review rounds used up'),
    Intake: inTickets('Intake waiting for the reporter'),
    'adopted, waiting on the author': inTickets('Adopted pull request waiting on its author'),
    'adopted, Result card': inTickets('Adopted pull request with a result'),
    'time and cost': insightsTicket,
  },
  '/runs/[id]': {
    claimed: runOf('Build with reported steps'),
    queued: runOf('Build waiting for an agent'),
    failed: runOf('Build that failed'),
    'claimed, no step': runOf('Build that has not reported'),
    'run with memory': memoryRun,
  },
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
  '/settings/products/[id]': {
    'first Product': linkOn('/settings/products', /^\/settings\/products\/\d+$/),
    'imported Product': connectOf('Look App', ''),
  },
  '/settings/products/[id]/connect': {
    'first look': connectOf('Look App'),
    importing: connectOf('Importing App'),
  },
  '/settings/products/new': '/settings/products/new',
  '/settings/profile': '/settings/profile',
  '/settings/workspace': '/settings/workspace',
}

type TabStop = { ring: boolean; hidden: boolean; name: string }

const signInWithKeyboard = async (page: Page) => {
  await page.goto('/login')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Email')).toBeFocused()
  await page.keyboard.type(email)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Password')).toBeFocused()
  await page.keyboard.type(password())
  await page.keyboard.press('Enter')
  await expect(page.getByRole('banner')).toBeVisible()
}

const reachMainWithSkipLink = async (page: Page) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
}

const focusedStop = (): TabStop | 'seen' | null => {
  const hasRing = (s: CSSStyleDeclaration) =>
    (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '')
  const labelOf = (e: HTMLElement) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40)
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return null
  if (el.dataset.a11ySeen) return 'seen'
  el.dataset.a11ySeen = '1'
  const s = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    ring: hasRing(s),
    hidden: r.width === 0 || r.height === 0,
    name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${labelOf(el)}`,
  }
}

const tabLap = async (page: Page): Promise<string[]> => {
  const stops: string[] = []
  for (let i = 0; ; i++) {
    expect(i, 'focus never wrapped: more than 200 Tab stops').toBeLessThan(200)
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(focusedStop)
    if (stop === null || stop === 'seen') break
    if (!stop.hidden) expect(stop.ring, `focus indicator on ${stop.name}`).toBe(true)
    stops.push(stop.name)
  }
  return stops
}

test.describe('keyboard', () => {
  test('sign in with the keyboard only, then skip link, then a visible focus ring on every Tab stop', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signInWithKeyboard(page)
    await reachMainWithSkipLink(page)
    await page.goto('/settings/profile')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const stops = await tabLap(page)
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
      await page
        .locator('h1')
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {})
      for (const t of ['light', 'dark'] as const) {
        await setTheme(page, t)
        expect(await scan(page), `${url} (${t})`).toEqual([])
      }
      await page.context().close()
    })
  }
})
