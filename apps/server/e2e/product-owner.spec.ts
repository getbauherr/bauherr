import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page, as: string, secret = password()) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(as)
  await page.getByLabel('Password').fill(secret)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const status = async (page: Page, path: string) => (await page.goto(path))?.status()

const ticketOutsideTheFactory = async (browser: Browser): Promise<string> => {
  const context = await browser.newContext()
  const admin = await context.newPage()
  await signIn(admin, email)
  const base = process.env.BASE_URL ?? 'http://localhost:3000'
  await context.addCookies([{ name: 'bauherr-ws', value: 'tickets', url: base }])
  await admin.goto('/inbox')
  const href = await admin.locator('main a[href^="/tickets/"]').first().getAttribute('href')
  await context.close()
  expect(href, 'a ticket of another Product').toBeTruthy()
  return href!.replace('/tickets/', '/requests/')
}

test('a Product owner signs in, lands on Requests and sees only their Product, and nothing of the factory', async ({
  page,
  browser,
}) => {
  await signIn(page, 'po-factory@example.com')
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Product' })).toContainText('Factory App')
  const own = page.getByRole('link', { name: 'Add target-year check' })
  await expect(own).toHaveAttribute('href', /^\/requests\/\d+$/)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Requests'])
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  await page.screenshot({ path: 'e2e/results/product-owner-requests.png' })
  const violations = (await new AxeBuilder({ page }).analyze()).violations
  expect(violations.map((v) => v.id)).toEqual([])

  await own.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Add target-year check' })).toBeVisible()

  const other = await ticketOutsideTheFactory(browser)
  const closed = ['/factory', '/settings', '/settings/profile', '/settings/bauherren', '/settings/products', '/inbox']
  for (const path of [...closed, other]) {
    expect(await status(page, path), path).toBe(404)
  }
})

test('a Product owner with no Product sees that nobody has given them one yet', async ({ page }) => {
  await signIn(page, 'po-none@example.com')
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByText('Nobody has given you a Product yet.')).toBeVisible()
  await page.screenshot({ path: 'e2e/results/product-owner-no-product.png' })
})

test('a Bauherr gives a Product owner two Products and both show in Requests after the next sign-in', async ({
  page,
  browser,
}) => {
  await signIn(page, email)
  await page.goto('/settings/bauherren')
  const added = `po-two-${Date.now()}@example.com`
  const add = page.locator('section', { hasText: 'Add Product owner' })
  await add.getByLabel('Email').fill(added)
  await add.getByRole('checkbox', { name: 'Acme Shop' }).check()
  await add.getByRole('checkbox', { name: 'Acme Web' }).check()
  await add.getByRole('button', { name: 'Add Product owner' }).click()
  const shown = await add.getByText('Temporary password (shown once)').textContent()
  const temporary = shown?.split(': ')[1]?.trim()
  expect(temporary, 'the temporary password').toBeTruthy()

  const owner = await (await browser.newContext()).newPage()
  await signIn(owner, added, temporary)
  await expect(owner).toHaveURL(/\/requests$/)
  await expect(owner.getByRole('combobox', { name: 'Product' }).getByRole('option')).toHaveText([
    'Acme Shop',
    'Acme Web',
  ])
})
