import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page, who: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Run page: timeline, list, collapsed details, re-run; an owner sees only the verdict and Re-run', async ({ page, browser }) => {
  await signIn(page, email)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Runs' }).click()
  const rows = page.locator('table tbody tr')
  await rows.filter({ hasText: 'Succeeded' }).filter({ hasText: /build/i }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const runUrl = page.url()

  await expect(page.locator('.rnode')).toHaveCount(0)
  const tabs = page.getByRole('navigation', { name: 'Run view' })
  await expect(tabs.getByRole('link', { name: 'Graph' })).toHaveCount(0)
  await expect(page.locator('.gstep > .track:not(.sub) .bar')).toHaveCount(3)
  await tabs.getByRole('link', { name: 'List' }).click()
  await page.locator('details.calls summary', { hasText: '1' }).first().click()
  await expect(page.locator('details.calls[open]')).toContainText('Edit')
  const panel = page.getByLabel('Details')
  await expect(panel).not.toHaveAttribute('open', /.*/)
  await panel.getByText('Details', { exact: true }).click()
  await expect(panel).toContainText('Duration')
  await expect(panel).toContainText('Succeeded')
  await expect(page.getByRole('button', { name: 'Re-run stage' })).toHaveCount(0)
  await page.goto(`${runUrl}?tab=graph`)
  await expect(tabs.getByRole('link', { name: 'Timeline' })).toHaveAttribute('aria-current', 'page')

  await page.goto('/runs')
  await rows.filter({ hasText: 'Waiting for you' }).filter({ hasText: 'Recover the stalled import' }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const needsHuman = page.url()
  const bar = page.getByRole('region', { name: 'Next step' })
  await expect(page.locator('[data-slot=button][data-variant=default]')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const last = (await page.locator('main > :last-child').boundingBox())!
  expect(last.y + last.height).toBeLessThanOrEqual((await bar.boundingBox())!.y)
  await page.setViewportSize({ width: 1280, height: 800 })
  await confirmClick(bar.getByRole('button', { name: 'Re-run stage' }), page.getByRole('button', { name: /Confirm re-run/ }), (t) => expect(page.getByText('A Run is already active for this stage').or(page.getByText(/^(Queued|Waiting for you|Waiting for a session)$/).first())).toBeVisible({ timeout: t }))
  await expect(page.getByText('A Run is already active for this stage').or(page.getByText(/^(Queued|Waiting for you|Waiting for a session)$/).first())).toBeVisible()

  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'member@example.com')
  await owner.goto(runUrl)
  for (const text of ['Details', 'Timeline', 'Tokens', 'Cost', 'Model', 'Release lock']) await expect(owner.getByText(text, { exact: false })).toHaveCount(0)
  await expect(owner.getByRole('navigation', { name: 'Run view' })).toHaveCount(0)
  await owner.goto(needsHuman)
  await expect(owner.getByRole('button', { name: 'Re-run stage' })).toBeVisible()
  await owner.context().close()
})

test('a continued Run links to the Run it continues and back, with its goal and gateway tokens in Details', async ({ page }) => {
  await signIn(page, email)
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/find a Ticket/).fill('#305')
  await page.getByRole('option', { name: /Chain: continue the build/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^#305 / })).toBeVisible()
  await page.getByText('Details', { exact: true }).first().click()
  await page.getByRole('table').last().locator('tbody tr').first().getByRole('link').click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const chain = page.getByRole('list', { name: 'Run chain' })
  await expect(chain).toContainText('Continues')
  await expect(chain).not.toContainText('Continued by')
  const panel = page.getByLabel('Details')
  await panel.getByText('Details', { exact: true }).click()
  await expect(panel).toContainText('1200 / 340')
  await chain.getByRole('link').click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  await expect(page.getByRole('list', { name: 'Run chain' })).toContainText('Continued by')
  await page.getByLabel('Details').getByText('Details', { exact: true }).click()
  await expect(page.getByLabel('Details')).toContainText('The export button downloads a CSV')
})
