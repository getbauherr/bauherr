import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const STALE = 'The ticket moved while this was open. Reload to see where it is now.'

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const open = async (page: Page, title: string) => {
  await page.goto('/inbox')
  const link = page.getByRole('link', { name: new RegExp(title) })
  const href = (await link.getAttribute('href'))!
  await page.goto(href.replace('/inbox?t=', '/tickets/'))
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  return new URL(page.url()).pathname
}

const enter = async (page: Page, title: string) => {
  await signIn(page)
  return open(page, title)
}

const enterOpen = async (page: Page, base: string) => {
  await signIn(page)
  await page.goto('/inbox')
  const waiting = page.getByRole('region', { name: 'Waiting on you' })
  const href = await waiting
    .getByRole('link', { name: new RegExp(`${base} \\d`) })
    .first()
    .getAttribute('href')
  await page.goto(href!.replace('/inbox?t=', '/tickets/'))
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${base} \\d$`) })).toBeVisible()
  return new URL(page.url()).pathname
}

test('approving a Brief stores the chosen option and the ticket moves on to Build', async ({ page }) => {
  await enterOpen(page, 'Brief with a decision to approve')
  await expect(page.getByText('This Brief has an open decision.')).toBeVisible()
  await page.getByRole('radio', { name: /Disk/ }).check()
  await page.getByRole('button', { name: 'Approve Brief' }).click()
  await expect(page.getByRole('button', { name: 'Approve Brief' })).toHaveCount(0)
  const path = page.getByRole('navigation', { name: 'Stage path' })
  await expect(path.locator('[aria-current="step"]')).toContainText('Build')
  await page.goto(`${new URL(page.url()).pathname}?tab=brief`)
  await expect(page.getByText('Stream the file to disk or to object storage?')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Stream the file' })).toContainText('Disk by you')
})

test('sending a Result back asks for a note in a dialog and records it', async ({ page }) => {
  const path = await enterOpen(page, 'Result to send back')
  await page.getByRole('button', { name: 'Send back with note' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Send back with note' })).toBeDisabled()
  await dialog.getByLabel('Note').fill('Add a test for the empty file.')
  await dialog.getByRole('button', { name: 'Send back with note' }).click()
  await expect(dialog).toHaveCount(0)
  await page.goto(`${path}?tab=activity`)
  await expect(page.getByText('The owner sent the Result back: Add a test for the empty file.')).toBeVisible()
})

test('accepting a Result ends the ticket', async ({ page }) => {
  await enterOpen(page, 'Result to accept')
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'The Result was accepted' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
})

test('answering a question from the agent records the chosen option', async ({ page }) => {
  const path = await enterOpen(page, 'Question from the agent')
  await expect(page.getByText('Which storage should the export use?')).toBeVisible()
  await page.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Choose an answer first.')
  await page.getByRole('radio', { name: 'Object storage' }).check()
  await page.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByRole('button', { name: 'Answer' })).toHaveCount(0)
  await page.goto(`${path}?tab=activity`)
  await expect(page.getByText('The owner answered: Object storage')).toBeVisible()
})

test('a decision on a card that moved on shows the stale sentence', async ({ page, browser }) => {
  const path = await enterOpen(page, 'Result decided twice')
  await page.route('**/api/changes', (route) => route.abort())
  const other = await browser.newPage()
  await signIn(other)
  await other.goto(path)
  await other.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(other.getByRole('status').filter({ hasText: 'The Result was accepted' })).toBeVisible()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(STALE)
  await other.close()
})

test('the tabs are addressable and the proof of a criterion opens from its row', async ({ page }) => {
  const path = await enter(page, 'Result to read')
  const tabs = page.getByRole('navigation', { name: 'Ticket tabs' })
  await expect(tabs.getByRole('link', { name: 'Now' })).toHaveAttribute('aria-current', 'page')
  await page.goto(`${path}?tab=brief`)
  await expect(tabs.getByRole('link', { name: 'Brief' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Exports over 50 MB finish instead of timing out.')).toBeVisible()
  await tabs.getByRole('link', { name: 'Result' }).click()
  await expect(page).toHaveURL(/\?tab=result$/)
  await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible()
  await tabs.getByRole('link', { name: 'Activity' }).click()
  await expect(page).toHaveURL(/\?tab=activity$/)
  await expect(page.getByText('A Brief was submitted')).toBeVisible()
  await page.goto(path)
  await page.getByRole('link', { name: /Screenshot/ }).click()
  await expect(page).toHaveURL(/\?proof=c2$/)
  await expect(page.getByRole('heading', { name: 'Proof for criterion 2' })).toBeVisible()
  await expect(page.getByRole('link', { name: /example\.com\/shots\/progress\.png/ })).toBeVisible()
})

test('an Intake ticket shows the check and the question sent to the reporter', async ({ page }) => {
  await enter(page, 'Intake waiting for the reporter')
  await expect(page.getByRole('heading', { name: 'Intake check' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Question sent to the reporter, round 1 of 2' })).toBeVisible()
  await expect(page.getByText('Which report shows the wrong year?')).toBeVisible()
  await expect(page.getByText('Waiting for the reporter. Nothing to do.')).toBeVisible()
})

test('an adopted pull request waiting on its author says so and lists the other pull requests', async ({ page }) => {
  await enter(page, 'Adopted pull request waiting on its author')
  await expect(page.getByText('Adopted pull request by dev-sam')).toBeVisible()
  await expect(page.getByText('Waiting on author', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Waiting on the author of the pull request.')).toBeVisible()
  const path = page.getByRole('navigation', { name: 'Stage path' })
  await expect(path).not.toContainText('Build')
  await expect(path.locator('[aria-current="step"]')).toContainText('Verify')
  const others = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Other pull requests' }) })
  await expect(others).toContainText('Another take on the fix')
  await expect(others).toContainText('dev-lee')
})

test('the Result card of an adopted pull request says that accepting merges it', async ({ page }) => {
  await enter(page, 'Adopted pull request with a result')
  await expect(page.getByText('Adopted pull request by dev-sam')).toBeVisible()
  await expect(page.getByText('Accept the Result to merge the pull request and finish the ticket.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
})

test('the run page lists the reported steps oldest first', async ({ page }) => {
  await enter(page, 'Build with reported steps')
  await page.getByRole('link', { name: /^Run \d+$/ }).click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const steps = page.getByRole('list').filter({ hasText: 'Started from record version 3.' }).getByRole('listitem')
  await expect(steps).toHaveCount(4)
  await expect(steps.first()).toContainText('Started from record version 3.')
  await expect(steps.last()).toContainText('Plan step 3 of 4: screenshots of both report pages.')
  await expect(page.getByRole('heading', { name: 'Context given to the agent' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Cost so far/ })).toBeVisible()
})

test('only a question whose answer is remembered says so', async ({ page }) => {
  const sentence = 'Your answer is remembered for similar tickets.'
  await enter(page, 'Question to read')
  await expect(page.getByText(sentence)).toBeVisible()
  await open(page, 'Deploy that did not finish')
  await expect(page.getByText(sentence)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Answer' })).toBeVisible()
})
