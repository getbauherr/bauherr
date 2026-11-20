import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'connect', url }])
}

const openConnect = async (page: Page, product: string) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: product, exact: true }).click()
  await page.goto(`${new URL(page.url()).pathname}/connect`)
  await expect(page.getByRole('heading', { name: `Connect ${product}` })).toBeVisible()
}

const steps = (page: Page) => page.getByRole('list', { name: 'Steps' })
const row = (page: Page, name: string) => page.getByRole('row', { name })

test('a Product that is imported shows the four steps, the counts and what the repository offers', async ({ page }) => {
  await openConnect(page, 'Connect Look')
  await expect(steps(page).getByRole('listitem')).toHaveCount(4)
  await expect(steps(page).locator('[aria-current=step]')).toContainText('First look')
  await expect(steps(page)).toContainText('One repository attached')
  await expect(steps(page)).toContainText('Every open issue checked. Nothing written to the forge.')
  await expect(page.getByRole('heading', { name: 'Open issues, 4' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open pull requests, 3' })).toBeVisible()
  await expect(row(page, /Linked to an issue/)).toContainText('1')
  await expect(row(page, /Not linked/)).toContainText('2')
  await expect(row(page, /Assigned to a person/)).toContainText('1')
  await expect(row(page, /No activity for a year/)).toContainText('1')
  const offers = page.getByRole('region', { name: 'What the repository offers' })
  await expect(offers).toContainText('Checks the forge requires: test · lint')
  await expect(offers).toContainText('Default branch is protected')
  await expect(offers).toContainText('Missing AGENTS.md')
  await expect(offers).toContainText('Missing Issue forms')
  const risk = page.getByRole('region', { name: 'Suggested risk areas' })
  await expect(risk).toContainText('security Risk area')
  await expect(risk).toContainText('ui Not a risk area')
  await expect(risk.getByRole('link', { name: 'Choose risk areas in Gates' })).toHaveAttribute('href', /#gates$/)
  await expect(page.getByText('At most 4 Briefs wait on you at a time.')).toBeVisible()
  await expect(page.locator('[data-slot=button][data-variant=default]')).toHaveCount(1)
})

test('while the import runs the page says so and counts what is mirrored so far', async ({ page }) => {
  await openConnect(page, 'Connect Importing')
  await expect(steps(page).locator('[aria-current=step]')).toContainText('Import')
  await expect(steps(page)).toContainText('The import is running: 3 issues, 0 pull requests mirrored so far.')
  await expect(page.getByText('The import is still running, so these counts are not final yet.')).toBeVisible()
})

test('the forge checks can be copied into the required checks once', async ({ page }) => {
  await openConnect(page, 'Connect Copy')
  const offers = page.getByRole('region', { name: 'What the repository offers' })
  await offers.getByRole('button', { name: 'Use these checks as required checks' }).click()
  await expect(offers.getByRole('button', { name: 'Use these checks as required checks' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Connect Copy', exact: true }).click()
  const required = page.locator('#proof').getByRole('group', { name: 'Required checks' })
  await expect(required.getByRole('checkbox', { name: /lint/ })).toBeChecked()
  await expect(required.getByRole('checkbox', { name: /test/ })).toBeChecked()
  await expect(page.locator('#proof').getByRole('button', { name: 'Use the checks the forge requires' })).toHaveCount(0)
})

test('Switch on makes the Product active and leads to the Factory view', async ({ page }) => {
  await openConnect(page, 'Connect Switch')
  await page.getByRole('button', { name: 'Switch on' }).click()
  await expect(page.getByText('Connect Switch is active. Nothing is built without your approval.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open the Factory view' })).toHaveAttribute('href', /^\/\?product=\d+$/)
  await expect(steps(page)).toContainText('Active. Briefs are prepared automatically.')
  await page.getByRole('link', { name: 'Open the Factory view' }).click()
  await expect(page).toHaveURL(/\/\?product=\d+$/)
  await expect(page.getByRole('heading', { name: 'Factory' })).toBeVisible()

  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Connect Switch', exact: true }).click()
  await page.locator('#state').getByRole('button', { name: 'Switch back to observing' }).click()
  await expect(page.locator('#state')).toContainText('Observing: nothing is written to the forge')
})
