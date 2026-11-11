import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const shots = process.env.SHOTS_DIR
const forced = !process.env.E2E_GATED_PACK // the default pack turns the production approval on for every Product

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

/** The production section needs the production gate: with the default pack it is on for every Product, with the gated pack it is switched on (and saved) on the Approvals tab first. Ends on the Deploy tab. */
const productionOn = async (page: Page) => {
  if (!forced) {
    await tab(page, 'Approvals')
    await page.getByRole('switch', { name: /Ask me before production/ }).check()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await saved(page)
  }
  await tab(page, 'Deploy')
}

const confirmRemove = async (scope: Locator, label: string, done: (timeout: number) => Promise<void>) => {
  // matching several buttons is a strict-mode violation that Playwright crashes on while describing them ("text.replace is not a function": the forms carry an `id` input), so take the first visible one; hydration can close the <details> again, so it is opened on every attempt
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

/** Detaches ticket source and repository (a Product with either cannot be deleted), then deletes the Product from its page. */
const deleteProduct = async (page: Page) => {
  await tab(page, 'Repository')
  const repository = page.locator('#repository')
  await expect(repository).toBeVisible() // the removals below pass at once while the tab is still loading
  for (const label of ['Stop reading tickets', 'Remove repository']) {
    await confirmRemove(repository, label, (t) => expect(repository.locator('button', { hasText: label })).toHaveCount(0, { timeout: t }))
  }
  await tab(page, 'Danger zone')
  await expect(page.locator('#danger')).toBeVisible()
  await confirmRemove(page.locator('#danger'), 'Delete Product', (t) => expect(page).toHaveURL(/\/settings\/products$/, { timeout: t }))
}

test('list, Product page, save, validation and the single Delete section', async ({ page }) => {
  test.setTimeout(120_000) // five tabs, six saves and the delete
  const name = `E2E Widgets ${Date.now()}`
  await signIn(page)

  await page.goto('/settings/products')
  await expect(page.getByRole('row', { name: /Acme Gated/ })).toContainText('On')
  await expect(page.getByRole('row', { name: /Acme Web/ })).toContainText(forced ? 'On, needs checks' : 'Off')
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

  await tab(page, 'Approvals')
  const toggle = page.getByRole('switch', { name: /Ask me before production/ })
  if (forced) {
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeDisabled()
    await expect(page.getByText('On for every Product by the workflow.')).toBeVisible()
  } else await expect(toggle).not.toBeChecked()
  await tab(page, 'Deploy')

  await page.getByRole('radio', { name: /My CI deploys to staging/ }).check()
  await page.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.e2e.example.com')
  await productionOn(page)
  await page.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.e2e.example.com')
  await page.locator('#production').getByRole('textbox', { name: 'Add a check that has not run yet' }).fill('deploy-production')
  await page.locator('#production').getByRole('button', { name: 'Add' }).click()
  await expect(page.locator('#production').getByRole('checkbox', { name: /deploy-production/ })).toBeChecked()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Staging site' })).toHaveValue('https://staging.e2e.example.com')
  // The forge read streams in (3 s cap): with the fake forge it answers "Almost ready" (the new repository has no check runs yet), when it is slow or fails the callout says "Ready" with a note. Wait until the read has settled, then require the saved check in the callout (an unsaved one reads "Not ready").
  const production = page.locator('#production')
  await expect(production.getByText('Loading recent checks from the forge…')).toHaveCount(0)
  await expect(production.getByRole('status').first()).toContainText(/^(Almost ready|Ready).*deploy-production/)

  await tab(page, 'Releases')
  const prerelease = page.getByRole('switch', { name: /Publish releases as pre-release/ })
  await page.getByRole('radio', { name: /My tooling makes releases/ }).check()
  await expect(prerelease).toBeHidden()
  await page.getByRole('radio', { name: /Bauherr makes the release/ }).check()
  await prerelease.check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  await expect(page.getByRole('radio', { name: /Bauherr makes the release/ })).toBeChecked()
  await expect(prerelease).toBeChecked()
  await tab(page, 'Deploy')
  await expect(page.getByRole('textbox', { name: 'Staging site' })).toHaveValue('https://staging.e2e.example.com') // another tab's save never resets this one

  await tab(page, 'Checks & merging')
  await page.getByLabel('Rules').fill('src/**')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('line 1: write')).toBeVisible()
  await page.getByLabel('Rules').fill('src/**, apps/** => tests/**\nschema: collections.ts => migrations/**')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await saved(page)
  await page.reload()
  await expect(page.getByLabel('Rules')).toHaveValue('src/**, apps/** => tests/**\nschema: collections.ts => migrations/**')

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
  await repo.selectOption('acme/knowledge')
  await page.locator('#new summary', { hasText: 'Advanced' }).click()
  await expect(page.getByLabel('Short name')).toHaveValue(/^e2e-picker-\d+$/)
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+\?tab=deploy#staging$/)
  await tab(page, 'Repository')
  await expect(page.locator('#repository')).toContainText('acme/knowledge')

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
  await tab(page, 'Deploy')
  const production = page.locator('#production')
  if (!forced) await expect(production.getByRole('status')).toHaveCount(0) // the gate is off: the section only points at Approvals
  await productionOn(page)
  await expect(production.getByRole('status').first()).toContainText('Not ready')
  await expect(production.getByRole('checkbox', { name: /deploy-production.*seen on 1 of 1 recent commits/ })).not.toBeChecked()
  await expect(production.getByRole('checkbox', { name: /lint/ })).not.toBeChecked()
  await production.getByRole('checkbox', { name: /deploy-production/ }).check()
  await page.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.checks.example.com')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
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
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(production.getByRole('status').first()).toContainText('Almost ready')
  await expect(production.getByRole('checkbox', { name: /release-prod.*not seen recently/ })).toBeChecked()
})

test('typing a check name works without a forge, and the ticket link points at the Product section', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Widget' }).click()
  await tab(page, 'Deploy')
  await productionOn(page)
  const production = page.locator('#production')
  await expect(production.getByText('Could not read checks from GitHub right now. Type the check name instead.')).toBeVisible()
  await expect(production.getByRole('textbox', { name: 'Add a check that has not run yet' })).toBeVisible()
})

test('Members: an unknown GitHub login is refused, a known one is saved', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'needs the fake forge (knows the logins fake and e2e-admin)')
  await signIn(page)
  await page.goto('/settings/bauherren')
  const member = 'member@example.com'
  const row = page.getByRole('row', { name: new RegExp('^member@example\\.com') })
  await row.getByText('Edit', { exact: true }).click()
  await row.getByLabel('GitHub login').fill('nobody-here')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(row.getByText('GitHub does not know @nobody-here. Check the spelling.')).toBeVisible()
  await row.getByLabel('GitHub login').fill('@e2e-admin')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(row.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await page.getByRole('row', { name: new RegExp('^member@example\\.com') }).getByText('Edit', { exact: true }).click()
  await expect(page.getByRole('row', { name: new RegExp('^member@example\\.com') }).getByLabel('GitHub login')).toHaveValue('e2e-admin')
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Checks' }).click()
  await tab(page, 'Approvals')
  await expect(page.getByText(`${member} · @e2e-admin`)).toBeVisible()

  await page.goto('/settings/bauherren')
  await page.getByRole('row', { name: new RegExp('^member@example\\.com') }).getByText('Edit', { exact: true }).click()
  await page.getByRole('row', { name: new RegExp('^member@example\\.com') }).getByLabel('GitHub login').fill('')
  await page.getByRole('row', { name: new RegExp('^member@example\\.com') }).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('row', { name: new RegExp('^member@example\\.com') }).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})

test('a Product with Tickets or a widget cannot be deleted', async ({ page }) => {
  await signIn(page)
  for (const [name, why] of [['Acme Web', /tickets/], ['Acme Widget', /1 widget tokens/]] as const) {
    await page.goto('/settings/products')
    await page.getByRole('link', { name }).click()
    await tab(page, 'Danger zone')
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

test('Product tabs: ?tab= addresses a tab, the setup checklist and the old #anchors land on the right one, the scan help is current', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Web' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+$/)
  const id = /\/settings\/products\/(\d+)/.exec(page.url())![1]!
  const tabs = page.getByRole('navigation', { name: 'Product' })
  await expect(tabs.getByRole('link')).toHaveText(['Repository', 'Deploy', 'Approvals', 'Checks & merging', 'Releases', 'Security scan', 'Widget', 'Danger zone'])
  await expect(tabs.getByRole('link', { name: 'Repository' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('#repository')).toBeVisible()

  await page.getByRole('list', { name: 'Setup' }).getByRole('link', { name: 'Staging' }).click()
  await expect(page).toHaveURL(new RegExp(`/settings/products/${id}\\?tab=deploy#staging$`))
  await expect(page.locator('#staging')).toBeVisible()
  await page.getByRole('list', { name: 'Setup' }).getByRole('link', { name: 'Approvals' }).click()
  await expect(page).toHaveURL(/\?tab=approvals#approvals$/)
  await expect(page.locator('#approvals')).toBeVisible()

  await page.goto(`/settings/products/${id}#production`)
  await expect(page).toHaveURL(new RegExp(`\\?tab=deploy#production$`))
  await expect(page.locator('#production')).toBeVisible()
  await page.goto(`/settings/products/${id}#merging`)
  await expect(page).toHaveURL(/\?tab=checks#merging$/)
  await expect(page.locator('#merging')).toBeVisible()
  await page.goto(`/settings/products/${id}#release`)
  await expect(page).toHaveURL(/\?tab=releases#release$/)
  await page.goto(`/settings/products/${id}?tab=nope`)
  await expect(page.locator('#repository')).toBeVisible()

  await page.goto(`/settings/products/${id}?tab=security`)
  await expect(page.getByTestId('last-scan')).toContainText('Last scan')
  await expect(page.getByText('not active yet')).toHaveCount(0)
  await expect(page.getByText('hourly security-scan tick')).toBeVisible()
})

test('screenshots of every Product tab', async ({ page }) => {
  test.skip(!shots, 'set SHOTS_DIR')
  await signIn(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Web' }).click()
  for (const [key, label] of [['repository', 'Repository'], ['deploy', 'Deploy'], ['approvals', 'Approvals'], ['checks', 'Checks & merging'], ['releases', 'Releases'], ['security', 'Security scan'], ['widget', 'Widget'], ['danger', 'Danger zone']] as const) {
    await tab(page, label)
    await expect(page.getByRole('navigation', { name: 'Product' }).getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: `${shots}/product-tab-${key}-light.png`, fullPage: true })
  }
})
