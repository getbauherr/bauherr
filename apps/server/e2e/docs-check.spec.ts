import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE || !process.env.E2E_FAKE_FORGE, 'needs E2E_EMAIL, E2E_PASSWORD_FILE and the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const shots = process.env.SHOTS_DIR
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

/** Signs in and opens the Docs tab of Docs Web in the Workspace of this spec (`seed-e2e.ts`). */
const docsTab = async (page: Page, who: string) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'docsco', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Docs Web' }).click()
  await page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Docs', exact: true }).click()
  await expect(page.locator('#docs')).toBeVisible()
}

test('Admin sees the Docs section, saves the paths and starts a check; a second click starts nothing', async ({ page }) => {
  await docsTab(page, email)
  await expect(page.getByTestId('last-docs-check')).toContainText('Last check never')
  const paths = page.getByLabel('Docs paths')
  await expect(paths).toHaveValue('README.md\ndocs/**/*.md')
  await paths.fill('README.md\ndocs/**/*.md\nCHANGELOG.md')
  await page.getByRole('button', { name: 'Save docs paths' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Docs paths')).toHaveValue('README.md\ndocs/**/*.md\nCHANGELOG.md')

  await page.getByRole('button', { name: 'Check docs now' }).click()
  const run = page.getByTestId('last-docs-check').getByRole('link', { name: /^Run #\d+$/ })
  await expect(run).toBeVisible()
  const first = await run.textContent()
  await page.getByRole('button', { name: 'Check docs now' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('last-docs-check').getByRole('link', { name: /^Run #\d+$/ })).toHaveText(first!)
  if (shots) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.screenshot({ path: `${shots}/product-docs-${scheme}.png`, fullPage: true })
    }
  }
})

test('a Bauherr sees the last check but neither the paths editor nor the button', async ({ page }) => {
  await docsTab(page, 'docs-bauherr@example.com')
  await expect(page.getByTestId('last-docs-check')).toBeVisible()
  await expect(page.getByLabel('Docs paths')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check docs now' })).toHaveCount(0)
})
