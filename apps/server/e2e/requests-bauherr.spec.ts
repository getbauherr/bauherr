import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'request-switch', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const product = (page: Page) => page.getByRole('button', { name: 'Product' })
const rowOf = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title })

test('a Bauherr has Requests in the navigation and switches the Product that scopes the list', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Requests' }).click()
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible()
  await expect(product(page)).toContainText('Switch Alpha')
  await expect(rowOf(page, 'Alpha needs a dark footer')).toBeVisible()
  await expect(rowOf(page, 'Beta loses the cart on reload')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('requests-bauherr-alpha.png') })

  await product(page).click()
  await page.getByRole('menuitem', { name: 'Switch Beta' }).click()
  await expect(page).toHaveURL(/\/requests\?product=\d+$/)
  await expect(product(page)).toContainText('Switch Beta')
  await expect(rowOf(page, 'Beta loses the cart on reload')).toBeVisible()
  await expect(rowOf(page, 'Alpha needs a dark footer')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('requests-bauherr-beta.png') })

  await page.goto('/requests')
  await expect(product(page)).toContainText('Switch Beta')
})

test('@fake-forge a new request goes to the switched Product and the Product is fixed after the first message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page)
  await page.goto('/requests')
  await product(page).click()
  await page.getByRole('menuitem', { name: 'Switch Beta' }).click()
  await page.getByRole('link', { name: 'New request' }).click()
  await expect(page).toHaveURL(/\/requests\/new\?product=\d+$/)
  await expect(product(page)).toContainText('Switch Beta')

  await product(page).click()
  await page.getByRole('menuitem', { name: 'Switch Alpha' }).click()
  await expect(product(page)).toContainText('Switch Alpha')
  await page.screenshot({ path: test.info().outputPath('requests-bauherr-new.png') })

  await page
    .getByRole('textbox', { name: 'Message input' })
    .fill('The export of our CO2 balance breaks for the big cities, it just stops.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByTestId('request-questions')).toBeVisible()
  await expect(product(page)).toHaveCount(0)
  await expect(page.getByText('Switch Alpha', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('requests-bauherr-sent.png') })
})
