import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Own Workspace (slug `stagelab`, the shipped factory) and own Admin (seed-e2e.ts): four Plan Tickets, one per state of the ax-scan Job.
const email = 'stage-admin@example.com'

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.use({ viewport: { width: 1280, height: 2000 } })

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'stagelab', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('workflow-graph')).toBeVisible()
})

const chip = (page: Page, job: string) => page.locator(`[data-testid=job-chip][data-job=${job}]`)

const ticketPage = async (page: Page, title: string) => {
  await page.goto('/workflow/plan')
  await page.getByRole('link', { name: new RegExp(title) }).first().click()
  await expect(page).toHaveURL(/\/tickets\/\d+/)
  await page.getByTestId('pane-tab-history').click()
  return page.getByTestId('step-jobs')
}

test('the Plan node lists its Jobs in order with the Tickets in each; a stage without Jobs shows none', async ({ page }) => {
  const chips = page.locator('[data-testid=job-chips][data-stage=plan]')
  await expect(chips.getByTestId('job-chip')).toHaveText([/^Plan\d/, /^AX scan\d/, /^Approve\d/])
  await expect(chip(page, 'ax-scan')).toHaveAttribute('data-count', '1')
  await expect(chip(page, 'approve')).toHaveAttribute('data-count', '2')
  await expect(chip(page, 'plan')).toHaveAttribute('data-count', '0')
  await expect(page.getByTestId('job-chips')).toHaveCount(1)
  const box = await chip(page, 'ax-scan').boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(24)
  await chip(page, 'ax-scan').click()
  await expect(page).toHaveURL(/\/workflow\/plan\?job=ax-scan$/)
})

test('the drill-down draws the Job graph with what each Job is and who is in it, and filters the list by Job', async ({ page }) => {
  await page.goto('/workflow/plan')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan')
  const cards = page.getByTestId('job-card')
  await expect(cards).toHaveCount(3)
  expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-job')))).toEqual(['plan', 'ax-scan', 'approve'])
  expect((await page.locator('[data-edge]').evaluateAll((els) => els.map((e) => e.getAttribute('data-edge')))).sort()).toEqual(['ax-scan>approve', 'plan>approve', 'plan>ax-scan'])
  await expect(page.locator('[data-edge="plan>approve"]')).toHaveAttribute('data-skip', 'true')
  const scan = page.locator('[data-testid=job-card][data-job=ax-scan]')
  await expect(scan.getByTestId('job-who')).toHaveText('Worked by Agent experience engineer')
  await expect(scan).toContainText('harden')
  await expect(scan.getByTestId('job-when')).toHaveText('Every Ticket')
  await expect(scan.getByTestId('job-blocking')).toContainText('Not blocking')
  await expect(scan.getByRole('link', { name: /Stage lab: scan in flight/ })).toBeVisible()
  const approve = page.locator('[data-testid=job-card][data-job=approve]')
  await expect(approve.getByTestId('job-who')).toHaveText('Asked of the Bauherr')
  await expect(approve.getByTestId('job-blocking')).toContainText('Blocking')
  await expect(approve.getByRole('link', { name: /Stage lab: waiting for approval/ })).toBeVisible()
  await expect(page.locator('.col[data-stage=plan] [data-testid=ticket-row], .col[data-stage=plan] tbody tr')).toHaveCount(4)

  await scan.getByRole('link', { name: 'Show only these in the list' }).click()
  await expect(page).toHaveURL(/\?job=ax-scan$/)
  await expect(page.getByTestId('job-filter')).toContainText('AX scan')
  await expect(page.locator('.col[data-stage=plan] tbody tr')).toHaveCount(1)
  await expect(page.locator('.col[data-stage=plan]')).toContainText('Stage lab: scan in flight')
  await page.getByTestId('job-filter').getByRole('link', { name: 'Show all Tickets of the stage' }).click()
  await expect(page).toHaveURL(/\/workflow\/plan$/)
  await expect(page.locator('.col[data-stage=plan] tbody tr')).toHaveCount(4)
})

test('a Job nobody is in says so, and a stage that has no Jobs, a split or the done stage', async ({ page }) => {
  await page.goto('/workflow/plan?job=plan')
  await expect(page.getByText('No Tickets in Plan right now.')).toBeVisible()
  await expect(page.locator('[data-testid=job-card][data-job=plan]')).toContainText('No Ticket here right now')
  await page.goto('/workflow/build')
  await expect(page.getByTestId('job-card')).toHaveCount(1)
  await expect(page.getByText('No open Tickets in Build.')).toBeVisible()
  for (const stage of ['done', 'nope']) {
    await page.goto(`/workflow/${stage}`)
    await expect(page.getByTestId('stage-page')).toHaveCount(0)
    await expect(page.getByText('could not be found')).toBeVisible()
  }
})

test('the Ticket page nests the Jobs under Plan: working, failed with the reason, skipped with the reason, done with executor and cost, approval waiting', async ({ page }) => {
  const job = (jobs: ReturnType<Page['getByTestId']>, id: string) => jobs.locator(`[data-testid=step-job][data-job=${id}]`)

  let jobs = await ticketPage(page, 'scan in flight')
  await expect(jobs).toBeVisible()
  await expect(job(jobs, 'plan')).toHaveAttribute('data-status', 'done')
  await expect(job(jobs, 'plan')).toContainText('Runner')
  await expect(job(jobs, 'plan').getByTestId('step-job-cost')).toContainText('$0.31')
  await expect(job(jobs, 'plan').getByTestId('step-job-duration')).toBeVisible()
  await expect(job(jobs, 'ax-scan')).toHaveAttribute('data-status', 'working')
  await expect(job(jobs, 'approve')).toHaveAttribute('data-status', 'pending')
  await expect(page.getByTestId('strip-jobs')).toContainText('AX scan working')

  jobs = await ticketPage(page, 'scan failed')
  await expect(job(jobs, 'ax-scan')).toHaveAttribute('data-status', 'failed')
  await expect(job(jobs, 'ax-scan').getByTestId('step-job-reason')).toContainText('could not read the repository')

  jobs = await ticketPage(page, 'scan skipped')
  await expect(job(jobs, 'ax-scan')).toHaveAttribute('data-status', 'skipped')
  await expect(job(jobs, 'ax-scan').getByTestId('step-job-reason')).toContainText('touches no security paths')
  await expect(page.getByTestId('skipped')).toHaveCount(0)

  jobs = await ticketPage(page, 'waiting for approval')
  await expect(job(jobs, 'ax-scan')).toHaveAttribute('data-status', 'done')
  await expect(job(jobs, 'approve')).toHaveAttribute('data-status', 'waiting')
})

for (const [name, size] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]] as const) {
  test(`screenshots ${name}`, async ({ page }) => {
    test.skip(!process.env.SHOTS_DIR, 'set SHOTS_DIR')
    await page.setViewportSize(size)
    const shoot = async (url: string, id: string) => {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.waitForTimeout(300) // allow-wait: screenshots only, lets the theme settle
        await page.screenshot({ path: `${process.env.SHOTS_DIR}/${id}-${name}-${scheme}.png`, fullPage: true })
      }
    }
    await shoot('/', 'home-chips')
    await shoot('/workflow/plan', 'stage-drilldown')
    await page.goto('/workflow/plan')
    await page.getByRole('link', { name: /scan failed/ }).first().click()
    await page.waitForLoadState('networkidle')
    await shoot(page.url().replace(/^https?:\/\/[^/]+/, ''), 'ticket-jobs')
  })
}
