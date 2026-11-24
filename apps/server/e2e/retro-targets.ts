import { expect, type Page } from '@playwright/test'

const START = '/memory/retro'

export const retroTarget = (suffix: string | null) => async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'retro', url }])
  if (suffix === null) return START
  await page.goto(START)
  const hrefs = await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  const href = hrefs.find((h) => /^\/memory\/retro\/\d+$/.test(h))
  expect(href, `a link to a Retro on ${START}`).toBeTruthy()
  return `${href}${suffix}`
}
