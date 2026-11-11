import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

const shot = async (page: Page, name: string) => {
  const dir = process.env.SHOTS_DIR
  if (!dir) return
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.locator('#factory-file').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${dir}/${name}-${scheme}-1280x800.png` })
  }
  await page.emulateMedia({ colorScheme: null })
}

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('Admin checks a broken factory file, applies a stage title, downloads it and resets to the default', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: 'Edit workflow' }).click()
  await expect(page).toHaveURL(/\/settings\/workflow#factory-file$/)
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('group', { name: 'Factory' }).getByRole('link', { name: 'Workflow' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Workflow', exact: true, level: 2 })).toBeVisible()

  // An apply clears the Workspace's WIP overrides (the file's `wip` governs again): remember them, put them back at the end so later specs see the same Board.
  const wipFields = page.getByLabel(/^(Plan|Build|Review|Release) \(now/)
  const wipBefore = await wipFields.evaluateAll((els) => els.map((e) => [e.getAttribute('name')!, (e as HTMLInputElement).value]))
  const editor = page.getByRole('textbox', { name: 'Factory file' })
  const state = page.locator('#factory-file + p')
  const original = await editor.inputValue()
  await expect(state).toContainText('Shipped default')
  await shot(page, 'factory-file-default')

  await editor.fill(original.replace('skill: run-contract', 'skill: nope'))
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'skill "nope" is not a skill of the pack' }).first()).toBeVisible()
  await shot(page, 'factory-file-findings')

  const title = `Construction ${Date.now() % 1000}`
  await editor.fill(original.replace(/(- name: build\n)(\s+)/, `$1$2title: ${title}\n$2`))
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Valid: \d+ stages, \d+ roles/ })).toBeVisible()
  await page.getByRole('button', { name: 'Apply' }).click()
  const dialog = page.getByRole('dialog', { name: 'Apply this factory file?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm apply' })).toBeEnabled()
  await shot(page, 'factory-file-confirm')
  await dialog.getByRole('button', { name: 'Confirm apply' }).click()
  await expect(state).toContainText(/Custom workflow \(version \d+\)/)
  await page.goto('/?view=board')
  await expect(page.locator('section.col[data-stage="build"] h2')).toContainText(title)

  await page.goto('/settings/workflow')
  expect(await editor.inputValue()).toContain(`title: ${title}`)
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download factory.yaml' }).click()
  expect((await (await download).createReadStream().then((s) => new Promise<string>((res) => { let b = ''; s.on('data', (c) => (b += c)); s.on('end', () => res(b)) }))).includes(`title: ${title}`)).toBe(true)

  await page.getByRole('button', { name: 'Reset to the shipped default' }).click()
  await page.getByRole('dialog', { name: 'Reset to the shipped default?' }).getByRole('button', { name: 'Confirm reset' }).click()
  await expect(state).toContainText('Shipped default')
  await page.goto('/?view=board')
  await expect(page.locator('section.col[data-stage="build"] h2')).not.toContainText(title)

  await page.goto('/settings/workflow')
  for (const [name, value] of wipBefore) await page.locator(`input[name="${name}"]`).fill(value)
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})

// Shares this file (and so one worker) with nothing else that writes the factory file: e2e/team.spec.ts only reads.
test('Admin changes the agent cap of a role on the Team page; it lands in a new factory file version and is reset afterwards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/settings/workflow')
  const wipFields = page.getByLabel(/^(Plan|Build|Review|Release) \(now/)
  const wipBefore = await wipFields.evaluateAll((els) => els.map((e) => [e.getAttribute('name')!, (e as HTMLInputElement).value]))

  await page.goto('/team')
  await page.getByRole('radiogroup', { name: 'Roles' }).locator('[data-role=engineer]').click()
  const sheet = page.getByRole('region', { name: 'Software engineer' })
  const save = sheet.getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  await sheet.getByLabel('No limit').uncheck()
  await sheet.getByRole('button', { name: 'More agents' }).click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(sheet.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radiogroup', { name: 'Roles' }).locator('[data-role=engineer]')).toContainText('2 agents')

  await page.goto('/settings/workflow')
  await expect(page.getByRole('textbox', { name: 'Factory file' })).toHaveValue(/engineer:\n(?:\s+.*\n)*?\s+agents: 2/)
  await expect(page.locator('#factory-file + p')).toContainText(/Custom workflow \(version \d+\)/)

  await page.getByRole('button', { name: 'Reset to the shipped default' }).click()
  await page.getByRole('dialog', { name: 'Reset to the shipped default?' }).getByRole('button', { name: 'Confirm reset' }).click()
  await expect(page.locator('#factory-file + p')).toContainText('Shipped default')
  for (const [name, value] of wipBefore) await page.locator(`input[name="${name}"]`).fill(value)
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})

// Both write the Workspace's WIP overrides, which an apply of the factory file clears: they live here, in the one worker that writes this Workspace's factory file.
test('WIP limits: set in Settings > Factory > Workflow, shown in the Workflow list heading, a waiting Ticket says why', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/workflow')
  await page.getByLabel(/^Build/).fill('1')
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

  await page.goto('/')
  await expect(page.locator('section.col[data-stage="build"] h2')).toContainText(/\d+ \/ 1/)
  const waiting = page.locator('section.col[data-stage="plan"] .card', { hasText: 'Waiting for a Build slot' })
  await expect(waiting.locator('[data-status=queued]')).toHaveText('Queued')
  await expect(waiting.getByTestId('status-detail')).toHaveText(/Build is full \(\d+\/1\)/)
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/workflow-waiting-1280x800.png` })
  await page.getByRole('link', { name: 'Waiting for a Build slot' }).click()
  await expect(page.getByTestId('action-bar').getByTitle(/Queued for Build: Build is full/)).toHaveCount(1)

  await page.goto('/settings/workflow')
  await page.getByLabel(/^Build/).fill('')
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})

test('the Workflow list WIP count links to the WIP limits section', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/workflow')
  await page.getByLabel(/^Build/).fill('1')
  await page.getByRole('button', { name: 'Save' }).first().click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.goto('/')
  await page.locator('section.col[data-stage="build"] h2 a').click()
  await expect(page).toHaveURL(/\/settings\/workflow#wip$/)
  await expect(page.getByRole('heading', { name: 'WIP limits' })).toBeVisible()
})
