import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const fake = !!process.env.E2E_FAKE_FORGE // the fake forge lists repositories; the real one fails with the dummy token (the fallback)

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Admin edits budget, adds a Connection with a missing field and a Bauherr', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()

  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Models & budget' }).click()
  await expect(page).toHaveURL(/\/settings\/models$/)
  const amount = String(40 + (Date.now() % 50))
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next.locator('[data-slot=button][data-variant=default]')).toHaveCount(1)
  await expect(page.locator('[data-slot=button][data-variant=default]')).toHaveCount(1)
  await expect(next).toContainText('Change the settings below')
  await page.getByLabel('Budget per 30 days').fill(amount + '0')
  await page.getByLabel('Budget per 30 days').fill(amount)
  await expect(next).toContainText('Unsaved changes')
  await next.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Budget per 30 days')).toHaveValue(amount)

  await page.getByRole('link', { name: 'Products' }).click()
  await expect(page.getByRole('cell', { name: 'acme/web' }).first()).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('link', { name: 'General' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible()
  await nav.getByRole('link', { name: 'Connections' }).click()
  await expect(page).toHaveURL(/\/settings\/connections$/)
  const form = page.locator('section', { hasText: 'Add Connection' })
  const name = `Foundry ${Date.now()}`
  await form.getByLabel('Name').fill(name)
  await form.getByLabel('Kind').selectOption('llm-provider')
  await form.getByLabel('Provider preset').selectOption('foundry')
  await form.getByLabel('Secret').fill('dummy')
  await form.getByRole('button', { name: 'Add Connection' }).click()
  await expect(form.getByText('required for foundry')).toBeVisible()
  await form.getByLabel('Azure resource').fill('e2e-resource')
  await form.getByRole('button', { name: 'Add Connection' }).click()
  await expect(page.getByRole('cell', { name })).toBeVisible()

  await nav.getByRole('link', { name: 'People' }).click()
  const added = `new-${Date.now()}@example.com`
  const add = page.locator('section', { hasText: 'Add Bauherr' })
  await add.getByLabel('Email').fill(added)
  await add.getByRole('button', { name: 'Add Bauherr' }).click()
  await expect(add.getByText('Temporary password (shown once)')).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(added) })
  await expect(row).toContainText('Bauherr')
  await expect(row).toContainText('Acme')
  await row.getByText('Edit', { exact: true }).click()
  await expect(row.getByLabel('Role')).toBeVisible()
  await row.getByText('Edit', { exact: true }).click()

  await confirmClick(row.getByRole('button', { name: 'Remove' }), row.getByRole('button', { name: 'Confirm remove' }), (t) => expect(page.getByRole('row', { name: new RegExp(added) })).toHaveCount(0, { timeout: t }))
  await expect(page.getByRole('row', { name: new RegExp(added) })).toHaveCount(0)

  await nav.getByRole('link', { name: 'General' }).click()
  const created = `Zzz ${Date.now()}`
  const ws = page.locator('section#new-workspace')
  await ws.getByLabel('Name').fill(created)
  await ws.getByRole('button', { name: 'Create Workspace' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.getByTestId('workspace-switcher').click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: created })).toBeVisible()
})

test('at 390 px the Next step bar does not cover the last field of the Models & budget page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/settings/models')
  const bar = page.getByRole('region', { name: 'Next step' })
  await expect(bar).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const field = page.locator('main input:visible, main select:visible, main textarea:visible').last()
  const box = (await field.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual((await bar.boundingBox())!.y)
})

// Lives in this file (not selects.spec.ts): it saves the whole Models & budget form and the Knowledge form, so it must not run in parallel with the budget test above.
test('Models & budget: model tiers are selects with Other...; Knowledge: the repository is a select or, with a failing forge, text', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/settings/models')
  const tier = page.getByLabel('Standard', { exact: true })
  await expect(tier).toHaveRole('combobox')
  await tier.click()
  await expect(page.getByRole('option')).toHaveText(['Preset default (claude-sonnet-5-5)', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'Other...'])
  await page.getByRole('option', { name: 'Other...' }).click()
  await expect(page.getByLabel('Standard, other')).toBeVisible()
  await page.reload()

  await page.goto('/settings/knowledge')
  const repo = page.getByLabel('Repository', { exact: true })
  if (fake) {
    await expect(repo).toHaveRole('combobox')
    await expect(repo).toHaveText('acme/knowledge')
    await repo.click()
    await page.getByRole('option', { name: 'Other...' }).focus() // by keyboard: the pointer click can land outside the viewport
    await page.keyboard.press('Enter')
    await page.getByLabel('Repository, other').fill('acme/knowledge') // the typed value must post under the field name
  } else {
    await expect(page.getByText('Could not list repositories; type owner/name.')).toBeVisible()
    await expect(repo).toHaveJSProperty('tagName', 'INPUT')
    await expect(repo).toHaveValue('acme/knowledge')
  }
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  const saved = page.getByLabel('Repository', { exact: true })
  if (fake) await expect(saved).toHaveText('acme/knowledge')
  else await expect(saved).toHaveValue('acme/knowledge')
})

test('the Settings nav is grouped by scope, the sidebar link opens Profile, and the old URLs and anchors still land', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  const nav = page.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('group')).toHaveCount(4)
  for (const [group, links] of [['Account', ['Profile', 'API keys']], ['Factory', ['Workflow', 'Templates', 'Models & budget', 'AI usage']], ['Workspace', ['General', 'Products', 'Connections', 'People', 'Knowledge']], ['Admin', ['Health', 'Audit', 'Chat feedback']]] as const) {
    await expect(nav.getByRole('group', { name: group }).getByRole('link')).toHaveText([...links])
  }
  await expect(nav.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('cell', { name: email, exact: true })).toBeVisible()

  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await page.goto('/settings/workspace#tiers')
  await expect(page).toHaveURL(/\/settings\/models#tiers$/)
  await page.goto('/settings/workspace#health')
  await expect(page).toHaveURL(/\/settings\/health$/)
  await page.goto('/settings/workspace#knowledge')
  await expect(page).toHaveURL(/\/settings\/knowledge$/)
  await page.goto('/settings/workspace#new-workspace')
  await expect(page).toHaveURL(/\/settings\/workspace#new-workspace$/)
  await expect(page.locator('section#new-workspace')).toBeVisible()

  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await expect(dialog.getByRole('option', { name: 'Settings: Factory › Workflow' })).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'Settings: Admin › Health' })).toBeVisible()
})
