import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const TITLE = 'Brief with a mockup'
const CAPTION = 'Export page, progress bar filling'

test('the Result card shows a screenshot proof as a picture and opens the gallery', async ({ page }) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/inbox')
  await page.getByRole('link', { name: new RegExp(TITLE) }).click()
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
  await page.goto(`${new URL(page.url()).pathname}?tab=result`)

  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Proof for criterion 1' }) })
  const picture = panel.getByRole('img', { name: CAPTION })
  await expect(picture).toHaveJSProperty('naturalWidth', 1280)
  await panel.getByRole('button', { name: CAPTION }).click()
  const dialog = page.getByRole('dialog', { name: CAPTION })
  await expect(dialog.getByRole('img', { name: CAPTION })).toHaveJSProperty('naturalWidth', 1280)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
