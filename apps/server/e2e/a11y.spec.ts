import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

/** WCAG 2.2 AA plus axe best practices. `scripts/a11y-coverage.ts` fails CI when a `page.tsx` route is missing from `routes` below or from `scripts/a11y-exceptions.ts`. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const scan = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).exclude('nextjs-portal').analyze()
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}. ${v.helpUrl}\n${v.nodes.map((n) => `  ${n.target.join(' ')}\n    ${n.failureSummary?.replace(/\n/g, '\n    ')}`).join('\n')}`)
}

const setTheme = (page: Page, id: 'light' | 'dark') => page.evaluate((t) => { localStorage.setItem('bauherr-theme', t); document.documentElement.dataset.theme = t; return Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime)).map((a) => a.finished.catch(() => {}))) }, id) // axe must not read colours mid-transition

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

/** The first link on `from` whose href matches `re`: a detail page whose id the seed does not fix. */
const linkOn = (from: string, re: RegExp) => async (page: Page) => {
  await page.goto(from)
  const hrefs = await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  const href = hrefs.find((h) => re.test(h))
  expect(href, `a link matching ${re} on ${from}`).toBeTruthy()
  return href!
}

/** Route pattern (as in the app directory, without route groups) to the URL scanned; a function finds the URL of a detail page. */
const routes: Record<string, string | ((page: Page) => Promise<string>)> = {
  '/': '/',
  '/inbox': '/inbox',
  '/insights': '/insights',
  '/knowledge': '/knowledge',
  '/knowledge/edit': process.env.E2E_FAKE_FORGE ? '/knowledge/edit?path=workspace/rules/style.md' : '/knowledge/edit?path=image.png', // the editor needs the fake forge; without it the refusal state is scanned
  '/release-notes': '/release-notes',
  '/releases': '/releases',
  '/requests': '/requests',
  '/requests/[id]': linkOn('/requests', /^\/requests\/\d+$/),
  '/requests/new': '/requests/new',
  '/runs': '/runs',
  '/runs/[id]': linkOn('/runs', /^\/runs\/\d+$/),
  '/settings': '/settings',
  '/settings/api-key': '/settings/api-key',
  '/settings/audit': '/settings/audit',
  '/settings/bauherren': '/settings/bauherren',
  '/settings/chat-feedback': '/settings/chat-feedback',
  '/settings/connections': '/settings/connections',
  '/settings/health': '/settings/health',
  '/settings/knowledge': '/settings/knowledge',
  '/settings/models': '/settings/models',
  '/settings/products': '/settings/products',
  '/settings/products/[id]': linkOn('/settings/products', /^\/settings\/products\/\d+$/),
  '/settings/products/new': '/settings/products/new',
  '/settings/profile': '/settings/profile',
  '/settings/templates': '/settings/templates',
  '/settings/templates/[name]': linkOn('/settings/templates', /^\/settings\/templates\/[^/]+$/),
  '/settings/usage': '/settings/usage',
  '/settings/workflow': '/settings/workflow',
  '/settings/workspace': '/settings/workspace',
  '/setup': '/setup',
  '/team': '/team',
  '/tickets/[id]': linkOn('/', /^\/tickets\/\d+$/),
  '/tickets/n/[number]': '/tickets/n/2',
  '/workflow/edit': '/workflow/edit',
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
    await page.locator('body').click({ position: { x: 0, y: 0 } })
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      const ring = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '')
        return { visible, hidden: r.width === 0 || r.height === 0, name: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}` }
      })
      if (ring && !ring.hidden) expect(ring.visible, `focus indicator on ${ring.name}`).toBe(true)
    }
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

  test('/login (signed out)', async ({ browser }) => {
    const anon = await (await browser.newContext()).newPage()
    await anon.goto('/login')
    for (const t of ['light', 'dark'] as const) {
      await setTheme(anon, t)
      expect(await scan(anon), t).toEqual([])
    }
    await anon.close()
  })

  for (const [route, target] of Object.entries(routes)) {
    test(route, async ({ browser }) => {
      test.setTimeout(120_000)
      const page = await (await browser.newContext({ storageState: session })).newPage()
      const url = typeof target === 'string' ? target : await target(page)
      await page.goto(url)
      await expect(page.getByRole('banner')).toBeVisible()
      await page.locator('h1').first().waitFor({ timeout: 10_000 }).catch(() => {}) // client-rendered pages: axe reports a missing h1 itself
      for (const t of ['light', 'dark'] as const) {
        await setTheme(page, t)
        expect(await scan(page), `${url} (${t})`).toEqual([])
      }
      await page.context().close()
    })
  }
})
