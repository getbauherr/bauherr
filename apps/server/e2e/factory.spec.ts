import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const enter = async (page: Page, path: string, workspace = 'factory') => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: workspace, url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto(path)
}

const STAGES = ['Intake', 'Brief', 'Build', 'Verify', 'Ship', 'Done']
const GROUPS = ['Waiting on you', 'Failed', 'Working', 'Waiting on others', 'Decided']
const TICKET = /^\/tickets\/\d+$/
const filters = (page: Page) => page.getByRole('navigation', { name: 'Filter tickets' })

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title }) })

test('the Factory view shows the six stages with their cards', async ({ page }) => {
  await enter(page, '/')
  await expect(page.getByRole('heading', { level: 1, name: 'Factory' })).toBeVisible()
  const board = page.getByRole('region', { name: 'Factory board' })
  await expect(board.getByRole('heading', { level: 2 })).toHaveText(STAGES)
  const ship = board.getByRole('region', { name: 'Ship' })
  await expect(ship.getByRole('link', { name: 'Add target-year check' })).toHaveAttribute('href', TICKET)
  await expect(ship.getByText('Result ready')).toBeVisible()
  const brief = board.getByRole('region', { name: 'Brief' })
  await expect(brief.getByRole('link', { name: 'Export fails for large files' })).toBeVisible()
  const done = board.getByRole('region', { name: 'Done' })
  await expect(done.getByRole('link', { name: 'Fix date format' })).toBeVisible()
  const all = filters(page).getByRole('link', { name: /^All/ })
  await expect(all).toHaveAttribute('aria-current', 'true')
})

test('a filter marks the URL and dims the cards that do not match', async ({ page }) => {
  await enter(page, '/')
  await filters(page)
    .getByRole('link', { name: /^Waiting on you/ })
    .click()
  await expect(page).toHaveURL(/\?show=you$/)
  await expect(filters(page).getByRole('link', { name: /^Waiting on you/ })).toHaveAttribute('aria-current', 'true')
  await expect(card(page, 'Rename report columns')).toHaveClass(/opacity-20/)
  await expect(card(page, 'Add target-year check')).not.toHaveClass(/opacity-20/)
  await expect(card(page, 'Import skips empty rows')).not.toHaveClass(/opacity-20/)
})

test('the Inbox lists the tickets waiting on the owner first and opens the first one', async ({ page }) => {
  await enter(page, '/inbox')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(GROUPS.map((group) => new RegExp(`^${group}`)))
  const rows = page.locator('[data-inbox-row]')
  for (const title of ['Export fails for large files', 'Add target-year check']) {
    const link = rows.filter({ hasText: title }).locator('a[href^="/tickets/"]').first()
    await expect(link).toHaveAttribute('href', TICKET)
  }
  await expect(rows.filter({ hasText: 'Import skips empty rows' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Rename report columns' })).toBeVisible()
  await expect(rows.first().getByRole('button')).toHaveAttribute('aria-current', 'true')
})

test('the Factory view counts Someday ideas per Product and links to the forge issue list', async ({ page }) => {
  await enter(page, '/', 'someday')
  const links = page.getByRole('link', { name: 'Someday: 2' })
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toHaveAttribute(
    'href',
    'https://github.com/someday/hub/issues?q=is:open+label:bauherr:someday',
  )
  await expect(links.nth(1)).toHaveAttribute(
    'href',
    'https://git.example.com/someday/lab/-/issues?label_name[]=bauherr:someday',
  )
})
