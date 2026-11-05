import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Admin edits budget, adds a Connection with a missing field and a Bauherr', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  const bar = page.locator('header.topbar')
  await expect(bar).toBeVisible()

  await bar.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings\/workspace$/)
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
  const advanced = nav.locator('details')
  await expect(advanced).not.toHaveAttribute('open', /.*/)
  await nav.getByText('Advanced', { exact: true }).click()
  await expect(advanced).toHaveAttribute('open', '')
  for (const name of ['Board & WIP', 'Connections', 'Agent keys', 'Audit', 'Runs']) await expect(advanced.getByRole('link', { name, exact: true })).toBeVisible()
  await advanced.getByRole('link', { name: 'Connections' }).click()
  await expect(page).toHaveURL(/\/settings\/connections$/)
  await expect(advanced).toHaveAttribute('open', '')
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
  await expect(row).toContainText('bauherr')
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
  await page.locator('header.topbar').getByRole('button', { name: 'User menu' }).click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: created })).toBeVisible()
})

test('at 390 px the Next step bar does not cover the last field of the Workspace page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
  await page.goto('/settings/workspace')
  const bar = page.getByRole('region', { name: 'Next step' })
  await expect(bar).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const field = page.locator('main input:visible, main select:visible, main textarea:visible').last()
  const box = (await field.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual((await bar.boundingBox())!.y)
})
