import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const openMemory = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page
    .context()
    .addCookies([{ name: 'bauherr-ws', value: 'record', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/memory')
  await expect(page.getByRole('heading', { name: 'Memory', level: 1 })).toBeVisible()
}

const SEEDED = 'Say what changed in the handoff.'

test('the Memory page lists what the factory remembers with how often it was handed and came back', async ({
  page,
}) => {
  await openMemory(page)
  const table = page.getByRole('table', { name: 'Memory' })
  const queue = table.getByRole('row', { name: /Never block the queue/ })
  await expect(queue.getByRole('cell').nth(2)).toHaveText('This ticket only')
  await expect(queue.getByRole('cell').nth(3)).toHaveText('3')
  await expect(queue.getByRole('cell').nth(4)).toHaveText('2')
  await expect(queue.getByRole('cell').nth(5)).toHaveText('Active')
  const seeded = table.getByRole('row', { name: new RegExp(SEEDED) })
  await expect(seeded.getByRole('cell').nth(1)).toHaveText('You wrote it')
  await expect(seeded.getByRole('cell').nth(2)).toHaveText('Every ticket')
  const filters = page.getByRole('navigation', { name: 'Filter memory' })
  await filters.getByRole('link', { name: /^Came back/ }).click()
  await expect(table.getByRole('row', { name: /Never block the queue/ })).toBeVisible()
  await expect(table.getByRole('row', { name: /Old rule nobody hit/ })).toHaveCount(0)
})

test('adds a memory for every ticket, edits it, switches it off and finds it under Off', async ({ page }) => {
  await openMemory(page)
  const first = `Use Sie in German texts ${Date.now()}.`
  const edited = first.replace('Use Sie', 'Always use Sie')
  await page.getByRole('link', { name: 'Add a memory' }).click()
  await page.getByLabel('What should the factory remember?').fill(first)
  await page.getByLabel('Applies to').selectOption('Every ticket')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const table = page.getByRole('table', { name: 'Memory' })
  const row = table.getByRole('row', { name: new RegExp(first.replace('.', '\\.')) })
  await expect(row.getByRole('cell').nth(2)).toHaveText('Every ticket')
  await expect(row.getByRole('cell').nth(5)).toHaveText('Active')
  await row.getByRole('link', { name: first }).click()
  await page.getByLabel('What the factory remembers').fill(edited)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  await expect(page.getByText('Before your first edit:')).toBeVisible()
  await expect(page.getByText(first, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Switch off' }).click()
  await expect(page.getByRole('button', { name: 'Switch on' })).toBeVisible()
  await page.goto('/memory')
  await page.getByRole('navigation', { name: 'Filter memory' }).getByRole('link', { name: /^Off/ }).click()
  const off = table.getByRole('row', { name: new RegExp(edited.replace('.', '\\.')) })
  await expect(off.getByRole('cell').nth(5)).toHaveText('Off')
})

test('a memory page lists the runs that got it and the run page lists the memory it was handed', async ({ page }) => {
  await openMemory(page)
  await page.getByRole('link', { name: SEEDED }).click()
  const fared = page.getByRole('table', { name: 'Runs that got this memory' })
  await fared.getByRole('link', { name: /^run \d+$/ }).first().click()
  const heading = page.getByRole('heading', { name: 'Memory handed to this run' })
  const section = page.locator('section').filter({ has: heading })
  await expect(section.getByRole('link', { name: SEEDED })).toBeVisible()
  await expect(section).toContainText('every ticket')
})

const LEARNED = ['Check the last row of every list.', 'Name the failing test in every finding.']

const newMemories = (page: Page) =>
  page.evaluate(() => {
    const links = [...document.querySelectorAll('nav[aria-label="Main"] a')]
    const link = links.find((a) => a.textContent?.startsWith('Memory'))
    return Number(link?.textContent?.match(/(\d+) new/)?.[1] ?? 0)
  })

test('a memory the agents wrote shows New, says where it came from, and is no longer New once opened', async ({
  page,
}) => {
  const text = LEARNED[test.info().retry] ?? ''
  await openMemory(page)
  await page.getByLabel('Product').selectOption({ label: 'Record Learn' })
  await page.getByRole('button', { name: 'Show' }).click()
  const table = page.getByRole('table', { name: 'Memory' })
  const row = table.getByRole('row', { name: new RegExp(text) })
  await expect(row.getByRole('cell').nth(1)).toHaveText(/^Reviewer finding, #5$/)
  await expect(row.getByRole('cell').nth(5)).toHaveText('New')
  const before = await newMemories(page)
  expect(before).toBeGreaterThan(0)
  const filters = page.getByRole('navigation', { name: 'Filter memory' })
  await filters.getByRole('link', { name: /^Agents found/ }).click()
  await expect(table.getByRole('row', { name: new RegExp(text) })).toBeVisible()
  await filters.getByRole('link', { name: /^You said/ }).click()
  await expect(table.getByRole('row', { name: new RegExp(text) })).toHaveCount(0)

  await filters.getByRole('link', { name: /^New/ }).click()
  await table.getByRole('link', { name: text }).click()
  await expect(page.getByText('Written as a memory by Learn')).toBeVisible()
  await expect(page.getByText('The list drops the last row. Evidence: open the list with three rows')).toBeVisible()

  await page.goto('/memory')
  await page.getByLabel('Product').selectOption({ label: 'Record Learn' })
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(table.getByRole('row', { name: new RegExp(text) }).getByRole('cell').nth(5)).toHaveText('Active')
  expect(await newMemories(page)).toBeLessThan(before)
})
