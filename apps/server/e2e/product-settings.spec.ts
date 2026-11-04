import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const shots = process.env.SHOTS_DIR
const forced = !process.env.E2E_GATED_PACK // the default pack turns the production approval on for every Product

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
}

test('list, Product page, save, validation and the single Delete section', async ({ page }) => {
  const name = `E2E Widgets ${Date.now()}`
  await signIn(page)

  await page.goto('/settings/products')
  await expect(page.getByRole('row', { name: /Acme Gated/ })).toContainText('On')
  await expect(page.getByRole('row', { name: /Acme Web/ })).toContainText(forced ? 'On, needs checks' : 'Off')
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Add Product' }).click()
  await page.getByLabel('Product name').fill(name)
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Setup' })).toContainText('Needs setup')
  await expect(page.getByRole('link', { name: 'Products', exact: true }).first()).toBeVisible()

  const toggle = page.getByRole('switch', { name: /Ask me before production/ })
  if (forced) {
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeDisabled()
    await expect(page.getByText('On for every Product by the workflow.')).toBeVisible()
  } else {
    await expect(toggle).not.toBeChecked()
    await expect(page.locator('#production')).toBeHidden()
  }

  await page.getByRole('radio', { name: /Bauherr calls my deploy hook/ }).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '2 fields need attention' })).toBeVisible()
  await expect(page.getByText('Required when Bauherr calls your deploy hook.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Staging site' })).toBeFocused()

  await page.getByRole('radio', { name: /My CI deploys to staging/ }).check()
  await page.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.e2e.example.com')
  if (!forced) await toggle.check()
  await page.getByLabel('Which check reports the production deploy?').fill('deploy-production')
  await page.getByRole('radio', { name: /Bauherr makes the release/ }).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Staging site' })).toHaveValue('https://staging.e2e.example.com')
  await expect(page.getByRole('radio', { name: /Bauherr makes the release/ })).toBeChecked()
  await expect(page.locator('#production')).toContainText('Ready')

  await page.getByLabel('Rules').fill('src/**')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('line 1: write')).toBeVisible()
  await page.getByLabel('Rules').fill('src/**, apps/** => tests/**\nschema: collections.ts => migrations/**')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Rules')).toHaveValue('src/**, apps/** => tests/**\nschema: collections.ts => migrations/**')

  await page.locator('#danger').getByRole('button', { name: 'Delete Product' }).click()
  await page.locator('#danger').getByRole('button', { name: 'Confirm remove' }).click()
  await expect(page).toHaveURL(/\/settings\/products$/)
  await expect(page.getByRole('link', { name })).toHaveCount(0)
  expect((await page.goto('/settings/products/999999'))?.status()).toBe(404)
})

test('a Product with Tickets or a widget cannot be deleted', async ({ page }) => {
  await signIn(page)
  for (const [name, why] of [['Acme Web', /tickets/], ['Acme Widget', /1 widget tokens/]] as const) {
    await page.goto('/settings/products')
    await page.getByRole('link', { name }).click()
    await expect(page.locator('#danger')).toContainText('Cannot delete yet')
    await expect(page.locator('#danger')).toContainText(why)
    await expect(page.locator('#danger').getByRole('button', { name: 'Delete Product' })).toHaveCount(0)
  }
})

test('screenshots of the list and a Product page', async ({ page }) => {
  test.skip(!shots, 'set SHOTS_DIR')
  await signIn(page)
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/settings/products')
      await page.screenshot({ path: `${shots}/products-list-${scheme}-${w}.png`, fullPage: true })
      await page.getByRole('link', { name: 'Acme Web' }).click()
      await expect(page.getByRole('heading', { name: 'Acme Web' })).toBeVisible()
      await page.screenshot({ path: `${shots}/product-page-${scheme}-${w}.png`, fullPage: true })
    }
  }
})
