import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const TITLE = 'Brief with a mockup'

test('a Brief with a mockup shows the thumbnail, and a click opens the image full size', async ({ page }) => {
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
  await expect(page.getByText('A user will see a difference on a screen: check the mockup.')).toBeVisible()

  const thumbnail = page.getByRole('button', { name: 'Export page, new: progress bar' })
  await expect(thumbnail).toBeVisible()
  await expect(thumbnail.getByRole('img')).toHaveJSProperty('naturalWidth', 1280)
  await expect(page.getByText('Export page, new: finished state')).toBeVisible()

  await thumbnail.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Export page, new: progress bar' })
  const full = dialog.getByRole('img', { name: 'Export page, new: progress bar' })
  await expect(full).toHaveJSProperty('naturalWidth', 1280)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
