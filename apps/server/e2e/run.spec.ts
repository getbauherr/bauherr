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

/** The Run page seed lives in a Workspace of its own, so it never shows on the Workflow, Overview or Team pages. */
const inRunLab = (page: Page) => page.context().addCookies([{ name: 'bauherr-ws', value: 'runpage', url: process.env.BASE_URL ?? 'http://localhost:3000' }])

/** Opens the Run of the Ticket whose title the row of /runs shows. */
const openRun = async (page: Page, title: string | RegExp) => {
  await page.goto('/runs')
  await page.locator('table tbody tr').filter({ hasText: title }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  return page.url()
}

/** One primary button at most in every state (a link made a button counts). */
const primaries = (page: Page) => page.locator('[data-slot=button][data-variant=default]')
const noPrimary = async (page: Page) => expect(await primaries(page).count()).toBe(0)

const bar = (page: Page) => page.getByRole('region', { name: 'Next step' })
const chip = (page: Page, text: string | RegExp) => page.locator('header [data-slot=badge]').filter({ hasText: text })

/** The seed's working Run was fresh at seeding time; keep it so however long the suite has run. */
const touch = (page: Page) => page.evaluate(async () => (await fetch(`/api/runs/${location.pathname.split('/').pop()}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ heartbeatAt: new Date().toISOString() }) })).ok)

test('working: chip Working, the not-reported-yet text, no button, never "No steps recorded."', async ({ page }) => {
  await signIn(page, email)
  await inRunLab(page)
  await openRun(page, 'Run page: working session')
  await touch(page)
  await page.reload()
  await expect(chip(page, /^Working$/)).toBeVisible()
  await expect(page.getByTestId('run-sentence')).toHaveText(/^Working\. No report yet, started \d+ min ago\.$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Timeline' })).toBeVisible()
  await expect(page.getByText(/^The agent has not reported a step yet\. It started .+ ago\. Steps appear here when it reports them\.$/)).toBeVisible()
  await expect(page.getByText('No steps recorded.')).toHaveCount(0)
  await expect(bar(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Release lock' })).toHaveCount(0)
  await noPrimary(page)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByText('Details', { exact: true })).toHaveCount(0)
})

test('waiting for CI: chip with the count, the sentence, the forge link as secondary, no primary', async ({ page }) => {
  await signIn(page, email)
  await openRun(page, 'Show CI on the ticket')
  await expect(chip(page, /^Waiting for CI 1\/2$/)).toBeVisible()
  await expect(page.getByTestId('run-sentence')).toHaveText('Waiting for CI: 1 of 2 checks done. The agent resumes when they finish.')
  const forge = page.getByTestId('forge-link')
  await expect(forge).toHaveAttribute('data-variant', 'outline')
  await expect(forge).toHaveAttribute('href', 'https://github.com/acme/ci/pull/88')
  await expect(page.getByRole('region', { name: 'Links' }).getByRole('link', { name: /^Pull request #88 on GitHub/ })).toBeVisible()
  await expect(bar(page)).toHaveCount(0)
  await noPrimary(page)
})

test('waiting for a session: one primary Connect an agent with the role preselected', async ({ page }) => {
  await signIn(page, email)
  await openRun(page, 'Wait for an engineer agent')
  await expect(chip(page, /^Waiting for a session$/)).toBeVisible()
  await expect(primaries(page)).toHaveCount(1)
  await expect(bar(page).getByRole('link', { name: 'Connect an agent' })).toHaveAttribute('href', '/team?role=engineer')
  await expect(page.getByText('Nothing yet. The agent has not started this Run.')).toBeVisible()
})

test('stuck: an Admin gets Release lock as a secondary behind a dialog; the owner only reads that an Admin can release it', async ({ page, browser }) => {
  await signIn(page, email)
  await inRunLab(page)
  const url = await openRun(page, 'Run page: stuck session')
  await expect(chip(page, /^Stuck$/)).toBeVisible()
  await expect(bar(page)).toContainText(/Not responding for \d+ min\. Session eng-stuck@laptop last seen/)
  await noPrimary(page)
  const release = bar(page).getByTestId('release-lock')
  await expect(release).toHaveAttribute('data-variant', 'outline')
  await release.click()
  const dialog = page.getByRole('dialog', { name: /^Release the lock on Run \d+\?$/ })
  await expect(dialog).toContainText('is not responding. The Run goes back to the queue.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)

  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'run-owner@example.com')
  await owner.goto(url)
  await expect(chip(owner, /^Stuck$/)).toBeVisible()
  await expect(owner.getByTestId('run-sentence')).toContainText('An Admin can release it.')
  await expect(owner.getByRole('button', { name: 'Release lock' })).toHaveCount(0)
  await expect(bar(owner)).toHaveCount(0)
  await owner.context().close()
})

test('session gone: names the session and why, links the agent, Release lock is secondary', async ({ page }) => {
  await signIn(page, email)
  await inRunLab(page)
  await openRun(page, 'Run page: session gone')
  await expect(chip(page, /^Session gone$/)).toBeVisible()
  await expect(bar(page)).toContainText(/Session eng-gone@laptop disconnected \d+ d ago\./)
  await expect(bar(page).getByTestId('release-lock')).toHaveAttribute('data-variant', 'outline')
  await noPrimary(page)
  await expect(page.getByRole('region', { name: 'Agent' }).getByRole('link', { name: 'eng-gone@laptop' })).toHaveAttribute('href', '/team/ses_e2e_run_gone')
})

test('succeeded: milestones for everyone, bars, tool calls and cost data for an Admin only, no tabs', async ({ page, browser }) => {
  await signIn(page, email)
  const url = await openRun(page, 'Export invoices as CSV')
  await expect(chip(page, /Succeeded$/)).toBeVisible()
  await expect(page.getByTestId('run-sentence')).toContainText(/^Finished .+ in .+/)
  await noPrimary(page)
  await expect(bar(page)).toHaveCount(0)
  const steps = page.getByRole('region', { name: 'Timeline' }).locator('ol > li')
  await expect(steps).toHaveCount(3)
  await expect(steps.first().locator('time')).toHaveAttribute('title', '2026-10-30 09:10 UTC')
  await expect(steps.first().locator('time')).toHaveAttribute('datetime', /^2026-10-30T09:10:05/)
  await page.locator('details.calls summary').first().click()
  await expect(page.locator('details.calls[open]')).toContainText('Edit')
  for (const name of ['Agent', 'Links', 'Times']) await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Agent' })).toContainText('Model')
  await page.getByRole('link', { name: 'Show bars' }).click()
  await expect(page.locator('.gstep > .track:not(.sub) .bar')).toHaveCount(3)
  await page.goto(`${url}?tab=graph`)
  await expect(steps).toHaveCount(3)
  await page.setViewportSize({ width: 375, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const top = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!.y
  expect(await top('Links')).toBeLessThan(await top('Timeline'))

  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'member@example.com')
  await owner.goto(url)
  await expect(owner.getByRole('region', { name: 'Timeline' }).locator('ol > li')).toHaveCount(3)
  await expect(owner.getByText('Implement the CSV export')).toBeVisible()
  for (const text of ['Tokens', 'Cost', 'Model', 'Provider', 'Release lock', 'Show bars', 'tool call']) await expect(owner.getByText(text, { exact: false })).toHaveCount(0)
  await owner.context().close()
})

test('failed: the first line of the error and one primary Re-run build; the owner has it too', async ({ page, browser }) => {
  await signIn(page, email)
  await inRunLab(page)
  const url = await openRun(page, 'Run page: failed build')
  await expect(chip(page, /Failed$/)).toBeVisible()
  await expect(bar(page)).toContainText('Checks failed: lint Re-run build starts a new Run.')
  await expect(primaries(page)).toHaveCount(1)
  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, 'run-owner@example.com')
  await owner.goto(url)
  await expect(owner.getByRole('button', { name: 'Re-run build' })).toBeVisible()
  await owner.context().close()
  const again = page.getByText('A Run is already active for this stage').or(page.getByText(/^(Queued|Waiting for a session)$/).first())
  await confirmClick(bar(page).getByRole('button', { name: 'Re-run build' }), page.getByRole('button', { name: /Confirm re-run/ }), (t) => expect(again).toBeVisible({ timeout: t }))
  await expect(again).toBeVisible()
})

test('needs human: Open ticket is the one primary, there is no Re-run, and the bar does not cover the page on a phone', async ({ page }) => {
  await signIn(page, email)
  await openRun(page, 'Recover the stalled import')
  await expect(chip(page, /^Waiting for you$/)).toBeVisible()
  await expect(primaries(page)).toHaveCount(1)
  await expect(bar(page).getByRole('link', { name: 'Open ticket' })).toHaveAttribute('href', /\/tickets\/\d+$/)
  await expect(page.getByRole('button', { name: /Re-run/ })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const last = (await page.locator('main > :last-child').boundingBox())!
  expect(last.y + last.height).toBeLessThanOrEqual((await bar(page).boundingBox())!.y)
})

test('a continued Run links to the Run it continues and back; an Admin reads its goal and gateway tokens', async ({ page }) => {
  await signIn(page, email)
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/find a Ticket/).fill('#305')
  await page.getByRole('option', { name: /Chain: continue the build/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^#305 / })).toBeVisible()
  await page.getByTestId('pane-tab-history').click()
  await page.getByRole('table').last().locator('tbody tr').first().getByRole('link').click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const chain = page.getByRole('list', { name: 'Run chain' })
  await expect(chain).toContainText('Continues')
  await expect(chain).not.toContainText('Continued by')
  await expect(page.getByRole('region', { name: 'Agent' })).toContainText('1200 / 340')
  await chain.getByRole('link').click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  await expect(page.getByRole('list', { name: 'Run chain' })).toContainText('Continued by')
  await expect(page.getByRole('heading', { level: 2, name: 'Goal' })).toBeVisible()
  await expect(page.getByText('The export button downloads a CSV')).toBeVisible()
})
