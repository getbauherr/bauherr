import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page, who = email) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const runOf = async (page: Page, title: string) => {
  await page.goto('/inbox')
  await page.getByRole('link', { name: new RegExp(title) }).first().click()
  await page.locator('main a[href^="/runs/"]').last().click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
}

const primaries = (page: Page) => page.locator('main [data-variant="default"]')

const STATES = [
  {
    title: 'Build waiting for an agent',
    word: 'Waiting for a session',
    button: 'Connect an agent',
    href: /^\/settings\/api-key$/,
  },
  { title: 'Build that failed', word: 'Failed', button: 'Open ticket', href: /^\/tickets\/\d+$/ },
  { title: 'Build with reported steps', word: 'Working', button: null, href: null },
  { title: 'Result to read', word: 'Finished', button: null, href: null },
]

for (const state of STATES) {
  test(`${state.word}: the header says so and offers ${state.button ?? 'no primary button'}`, async ({ page }) => {
    await signIn(page)
    await runOf(page, state.title)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('main header').getByText(new RegExp(`(^|\\s)${state.word}$`)).first()).toBeVisible()
    await expect(primaries(page)).toHaveCount(state.button ? 1 : 0)
    if (state.button && state.href) {
      const button = page.getByRole('link', { name: state.button })
      await expect(primaries(page)).toHaveText(state.button)
      await expect(button).toHaveAttribute('href', state.href)
    }
  })
}

test('a claimed run with no step says when it started', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Build that has not reported')
  await expect(
    page.getByText(/^The agent has not reported a step yet\. It started \d+ min ago\.$/),
  ).toBeVisible()
})

test('a step shows its time relative, with the exact time in the title and a datetime', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Build with reported steps')
  const time = page.locator('ol time').first()
  await expect(time).toContainText(/ago|just now/)
  await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/)
  await expect(time).toHaveAttribute('title', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/)
})

const links = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Links' }) })

test('the Links panel opens the pull request on its forge in a new tab, and names the ticket', async ({
  page,
}) => {
  await signIn(page)
  await runOf(page, 'Result to read')
  const pull = links(page).getByRole('link', { name: /^Pull request #\d+ on GitHub/ })
  await expect(pull).toContainText('(opens in new tab)')
  await expect(pull).toHaveAttribute('target', '_blank')
  await expect(pull).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(links(page).getByRole('link', { name: /^Ticket #\d+ Result to read$/ })).toBeVisible()
})

test('the Links panel names the session that works the run', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Build with reported steps')
  await expect(links(page).getByRole('link', { name: 'Runner' })).toHaveAttribute('href', '/settings/api-key')
})

test('the Links panel leaves the pull request out when the ticket has none', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Build that failed')
  await expect(links(page).getByRole('link', { name: /Pull request/ })).toHaveCount(0)
  await expect(links(page).getByRole('link', { name: /^Ticket #\d+/ })).toBeVisible()
})

test('at 375 px nothing scrolls sideways and the order is header, steps, handoff, links, cost', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await signIn(page)
  await runOf(page, 'Build that failed')
  await expect(page.getByText('unbrokenunbroken').first()).toBeVisible()
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  const tops: number[] = []
  for (const name of [/^Run \d+$/, 'Reported steps', /^Handoff/, 'Links', /^Cost/]) {
    const box = await page.getByRole('heading', { name }).boundingBox()
    tops.push(box?.y ?? -1)
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b))
  expect(tops.every((top) => top >= 0)).toBe(true)
})

test('an Admin sees the cost, a member sees no cost and no dollar sign', async ({ page }) => {
  await signIn(page)
  await runOf(page, 'Build with reported steps')
  await expect(page.getByRole('heading', { name: /^Cost/ })).toBeVisible()
  await page.context().clearCookies()
  await signIn(page, 'run-member@example.com')
  await runOf(page, 'Build with reported steps')
  await expect(page.getByRole('heading', { name: 'Reported steps' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Cost/ })).toHaveCount(0)
  expect(await page.locator('main').innerText()).not.toContain('$')
})
