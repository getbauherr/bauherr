import { chromium, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Page speed of `/`, a Ticket page and `/settings/workspace` against a running production build seeded by `seed:e2e`.
 * On demand, not in CI: `BASE_URL=... E2E_EMAIL=... E2E_PASSWORD_FILE=... [RUNS=5] tsx scripts/measure-pages.ts`
 * (host has no Chromium: run it in the Playwright image, see docs/ui.md).
 * Cold: a fresh browser context per run (no HTTP cache, new session). Warm: repeat loads in one context after a priming load.
 * Prints the median per page: TTFB (response start minus request start) and load (loadEventEnd), both in ms.
 */
const env = (k: string): string => process.env[k] ?? (() => { throw new Error(`missing env ${k}`) })()
const base = env('BASE_URL')
const runs = Number(process.env.RUNS ?? 5)
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

const login = async (page: Page): Promise<void> => {
  await page.goto(`${base}/login`)
  await page.getByLabel('Email').fill(env('E2E_EMAIL'))
  await page.getByLabel('Password').fill(readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${base}/`)
}

const timing = (page: Page): Promise<{ ttfb: number; load: number }> =>
  page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    return { ttfb: n.responseStart - n.requestStart, load: n.loadEventEnd - n.startTime }
  })

const visit = async (page: Page, path: string) => {
  await page.goto(`${base}${path}`, { waitUntil: 'load' })
  await page.waitForFunction(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).loadEventEnd > 0)
  return timing(page)
}

const browser = await chromium.launch()
const ticketPath = async (): Promise<string> => {
  const page = await (await browser.newContext()).newPage()
  await login(page)
  return (await page.getByRole('link', { name: 'Export invoices as CSV' }).first().getAttribute('href'))!
}
const paths = ['/', await ticketPath(), '/settings/workspace']
const result: Record<string, { cold: { ttfb: number[]; load: number[] }; warm: { ttfb: number[]; load: number[] } }> = {}
for (const path of paths) result[path] = { cold: { ttfb: [], load: [] }, warm: { ttfb: [], load: [] } }

for (const path of paths) {
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page)
    const t = await visit(page, path)
    result[path].cold.ttfb.push(t.ttfb)
    result[path].cold.load.push(t.load)
    await ctx.close()
  }
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page)
  await visit(page, path)
  for (let i = 0; i < runs; i++) {
    const t = await visit(page, path)
    result[path].warm.ttfb.push(t.ttfb)
    result[path].warm.load.push(t.load)
  }
  await ctx.close()
}
await browser.close()

console.log('| page | cold TTFB | cold load | warm TTFB | warm load |\n|---|---|---|---|---|')
for (const [path, r] of Object.entries(result)) {
  const m = (xs: number[]) => Math.round(median(xs))
  console.log(`| ${path.replace(/\d+$/, '<id>')} | ${m(r.cold.ttfb)} | ${m(r.cold.load)} | ${m(r.warm.ttfb)} | ${m(r.warm.load)} |`)
}
console.log(JSON.stringify(result))
