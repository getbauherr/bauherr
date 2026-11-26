import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const RUNS = 5
const CONTENT_LIMIT_MS = 5000

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

declare global {
  interface Window {
    __content: number | null
  }
}

const measured = z.object({ ttfb: z.number(), content: z.number() })

const watch = (selector: string) => {
  window.__content = null
  const check = () => {
    if (window.__content === null && document.querySelector(selector)) window.__content = performance.now()
  }
  new MutationObserver(check).observe(document, { subtree: true, childList: true })
}

const load = async (page: Page, path: string, selector: string) => {
  await page.addInitScript(watch, selector)
  await page.goto(path, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__content !== null)
  return measured.parse(
    await page.evaluate(() => ({
      ttfb: performance.getEntriesByType('navigation').map((e) => e.toJSON().responseStart as number)[0],
      content: window.__content,
    })),
  )
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const TICKETS = 'a[href^="/tickets/"]'

const measure = async (page: Page, name: string, path: string, selector: string) => {
  const runs: z.infer<typeof measured>[] = []
  for (let i = 0; i < RUNS; i++) runs.push(await load(page, path, selector))
  const ttfb = Math.round(median(runs.map((r) => r.ttfb)))
  const content = Math.round(median(runs.map((r) => r.content)))
  console.log(`PERFLOAD ${name} ttfb=${ttfb} content=${content}`)
  expect(content, 'time to content').toBeLessThan(CONTENT_LIMIT_MS)
}

test('page load: first byte and content of Inbox, Factory board and a ticket', async ({ page }) => {
  await signIn(page)
  await page.goto('/inbox')
  const ticket = await page.locator(TICKETS).first().getAttribute('href')
  expect(ticket).toBeTruthy()
  await measure(page, 'inbox', '/inbox', TICKETS)
  await measure(page, 'board', '/', TICKETS)
  await measure(page, 'ticket', ticket!, 'nav[aria-label="Stage path"]')
})
