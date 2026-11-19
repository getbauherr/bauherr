import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name, exact: true }).click()
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

const productionOn = async (page: Page) => {
  await tab(page, 'Deploy')
  const gate = page.getByRole('switch', { name: /Ask me before production/ })
  if (!(await gate.isChecked())) {
    await gate.check()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await saved(page)
    await page.reload()
  }
  await expect(page.locator('#production')).toBeVisible()
}

const checksLoaded = (page: Page, section: string) => expect(page.locator(section).getByText('Loading recent checks from the forge…')).toHaveCount(0)

const confirmRemove = async (scope: Locator, label: string, done: (timeout: number) => Promise<void>) => {
  const confirm = scope.locator('button:visible', { hasText: 'Confirm remove' }).first()
  const holds = (timeout: number) => done(timeout).then(() => true, () => false)
  await expect(async () => {
    if (await holds(500)) return
    await scope.locator('details[data-slot=advanced]').evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)))
    if (!(await confirm.isVisible())) await scope.locator('button', { hasText: label }).first().click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000, noWaitAfter: true })
    await done(8_000)
  }).toPass({ timeout: 40_000 })
}

const deleteProduct = async (page: Page) => {
  await tab(page, 'Repository')
  const repository = page.locator('#repository')
  await expect(repository).toBeVisible()
  for (const label of ['Stop reading tickets', 'Remove repository']) {
    await confirmRemove(repository, label, (t) => expect(repository.locator('button', { hasText: label })).toHaveCount(0, { timeout: t }))
  }
  await tab(page, 'Danger zone')
  await expect(page.locator('#danger')).toBeVisible()
  await confirmRemove(page.locator('#danger'), 'Delete Product', (t) => expect(page).toHaveURL(/\/settings\/products$/, { timeout: t }))
}

test('list, Product page, save, validation, path sets and the single Delete section', async ({ page }) => {
  test.setTimeout(120_000)
  const name = `E2E Widgets ${Date.now()}`
  await signIn(page)

  await page.goto('/settings/products')
  await expect(page.getByRole('row', { name: /Acme Web/ })).toContainText('Off')
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Add Product' }).click()
  await page.getByLabel('Product name').fill(name)
  if (process.env.E2E_FAKE_FORGE) {
    await page.getByLabel('Repository', { exact: true }).selectOption({ label: 'Other...' })
    await page.getByLabel('Other repository').fill('e2e/widgets')
  } else await page.getByLabel('Repository', { exact: true }).fill('e2e/widgets')
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+\?tab=deploy#staging$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Setup' })).toContainText('Needs setup')
  await expect(page.getByRole('link', { name: 'Products', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: 'Deploy' })).toHaveAttribute('aria-current', 'page')

  await page.getByRole('radio', { name: /Bauherr calls my deploy hook/ }).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '2 fields need attention' })).toBeVisible()
  await expect(page.getByText('Required when Bauherr calls your deploy hook.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Staging site' })).toBeFocused()

  await page.getByRole('radio', { name: /My CI deploys to staging/ }).check()
  await page.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.e2e.example.com')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  await expect(page.getByRole('switch', { name: /Ask me before production/ })).not.toBeChecked()
  await expect(page.locator('#production')).toHaveCount(0)

  await productionOn(page)
  await expect(page.getByRole('textbox', { name: 'Staging site' })).toHaveValue('https://staging.e2e.example.com')
  await checksLoaded(page, '#production')
  await page.locator('#production').getByRole('textbox', { name: 'Add a check that has not run yet' }).fill('deploy-production')
  await page.locator('#production').getByRole('button', { name: 'Add' }).click()
  await expect(page.locator('#production').getByRole('checkbox', { name: /deploy-production/ })).toBeChecked()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  const production = page.locator('#production')
  await expect(production.getByText('Loading recent checks from the forge…')).toHaveCount(0)
  await expect(production.getByRole('status').first()).toContainText(/^(Almost ready|Ready).*deploy-production/)

  await tab(page, 'Path sets')
  const sets = page.locator('#path-sets')
  await sets.getByLabel('Path sets').fill('security: src/auth/**, src/api/**\nui:')
  await sets.getByRole('button', { name: 'Save', exact: true }).click()
  await saved(page)
  await page.reload()
  await expect(page.locator('#path-sets').getByLabel('Path sets')).toHaveValue('security: src/auth/**, src/api/**\nui:')
  await page.locator('#path-sets').getByLabel('Path sets').fill('Security: x')
  await page.locator('#path-sets').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('is not a set name')).toBeVisible()

  await deleteProduct(page)
  await expect(page.getByRole('link', { name })).toHaveCount(0)
  expect((await page.goto('/settings/products/999999'))?.status()).toBe(404)
})

test('add a Product: pick the repository from the forge, a taken short name is refused', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'the Repository select needs the fake forge (BAUHERR_E2E_FAKE_FORGE=1)')
  const name = `E2E Picker ${Date.now()}`
  await signIn(page)
  await page.goto('/settings/products/new')
  await page.getByLabel('Product name').fill(name)
  const repo = page.getByLabel('Repository', { exact: true })
  await expect(repo.getByRole('option', { name: 'acme/web' })).toHaveCount(1)
  await expect(repo.getByRole('option', { name: 'Other...' })).toHaveCount(1)
  await repo.selectOption('acme/picker')
  await page.locator('#new summary', { hasText: 'Advanced' }).click()
  await expect(page.getByLabel('Short name')).toHaveValue(/^e2e-picker-\d+$/)
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+\?tab=deploy#staging$/)
  await tab(page, 'Repository')
  await expect(page.locator('#repository')).toContainText('acme/picker')

  await page.goto('/settings/products/new')
  await page.getByLabel('Product name').fill(name)
  await expect(page.getByLabel('Repository', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page.getByText('Another Product already uses this short name.')).toBeVisible()

  await page.goto('/settings/products')
  await page.getByRole('link', { name }).click()
  await deleteProduct(page)
})

test('the check picker offers the checks the forge reported and the callout turns Ready', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the fake forge (acme/checks reports deploy-production)')
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Checks' }).click()
  await productionOn(page)
  const production = page.locator('#production')
  await checksLoaded(page, '#production')
  await expect(production.getByRole('status').first()).toContainText('Not ready')
  await expect(production.getByRole('checkbox', { name: /deploy-production.*seen on 1 of 1 recent commits/ })).not.toBeChecked()
  await expect(production.getByRole('checkbox', { name: /lint/ })).not.toBeChecked()
  await production.getByRole('checkbox', { name: /deploy-production/ }).check()
  await page.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.checks.example.com')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  await expect(production.getByRole('status').first()).toContainText('Ready')
  await expect(production.getByRole('checkbox', { name: /deploy-production/ })).toBeChecked()
  await production.getByText('How does my pipeline know when to deploy?').click()
  await expect(production.getByText('bauherr:approved:production').first()).toBeVisible()
  await expect(production.locator('pre')).toContainText('CHECKS: |')
  await expect(production.locator('pre')).toContainText('deploy-production')
  await expect(production.getByRole('button', { name: 'Copy' })).toBeVisible()

  await production.getByRole('checkbox', { name: /deploy-production/ }).uncheck()
  await production.getByRole('textbox', { name: 'Add a check that has not run yet' }).fill('release-prod')
  await production.getByRole('textbox', { name: 'Add a check that has not run yet' }).press('Enter')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  await expect(production.getByRole('status').first()).toContainText('Almost ready')
  await expect(production.getByRole('checkbox', { name: /release-prod.*not seen recently/ })).toBeChecked()
})

test('typing a check name works without a forge', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Bare' }).click()
  await productionOn(page)
  const production = page.locator('#production')
  await expect(production.getByText('Could not read checks from GitHub right now. Type the check name instead.')).toBeVisible()
  await expect(production.getByRole('textbox', { name: 'Add a check that has not run yet' })).toBeVisible()
})

test('Members: an unknown GitHub login is refused, a known one is saved', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the fake forge (knows the logins fake and e2e-admin)')
  const member = () => page.getByRole('row', { name: new RegExp('^members-edit@example\\.com') })
  await signIn(page)
  await page.goto('/settings/bauherren')
  await member().getByText('Edit', { exact: true }).click()
  await member().getByLabel('GitHub login').fill('nobody-here')
  await member().getByRole('button', { name: 'Save' }).click()
  await expect(member().getByText('GitHub does not know @nobody-here. Check the spelling.')).toBeVisible()
  await member().getByLabel('GitHub login').fill('@fake')
  await member().getByRole('button', { name: 'Save' }).click()
  await expect(member().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await member().getByText('Edit', { exact: true }).click()
  await expect(member().getByLabel('GitHub login')).toHaveValue('fake')

  await member().getByLabel('GitHub login').fill('')
  await member().getByRole('button', { name: 'Save' }).click()
  await expect(member().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})

test('a Product with a repository cannot be deleted', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Web' }).click()
  await tab(page, 'Danger zone')
  await expect(page.locator('#danger')).toContainText('Cannot delete yet')
  await expect(page.locator('#danger')).toContainText(/repositories/)
  await expect(page.locator('#danger').getByRole('button', { name: 'Delete Product' })).toHaveCount(0)
})

test('Product tabs: ?tab= addresses a tab, the setup checklist and the #anchors land on the right one', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Web' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+$/)
  const id = /\/settings\/products\/(\d+)/.exec(page.url())![1]!
  const tabs = page.getByRole('navigation', { name: 'Product' })
  await expect(tabs.getByRole('link')).toHaveText(['Repository', 'Deploy', 'Path sets', 'Danger zone'])
  await expect(tabs.getByRole('link', { name: 'Repository' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#repository')).toBeVisible()

  await page.getByRole('list', { name: 'Setup' }).getByRole('link', { name: 'Staging' }).click()
  await expect(page).toHaveURL(new RegExp(`/settings/products/${id}\\?tab=deploy#staging$`))
  await expect(page.locator('#staging')).toBeVisible()

  await page.goto(`/settings/products/${id}#production`)
  await expect(page).toHaveURL(new RegExp('\\?tab=deploy#production$'))
  await expect(page.locator('#staging')).toBeVisible()
  await page.goto(`/settings/products/${id}?tab=nope`)
  await expect(page.locator('#repository')).toBeVisible()
})
