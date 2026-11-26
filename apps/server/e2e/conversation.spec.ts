import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('a conversation keeps its messages and its picture after a reload', async ({ page }) => {
  await signIn(page)
  await page.goto('/conversations')
  await page.getByRole('button', { name: 'Start a conversation' }).click()
  await expect(page).toHaveURL(/\/conversations\/\d+$/)

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add attachment' }).click()
  await (await chooser).setFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PIXEL })
  await expect(page.getByRole('button', { name: 'Remove screen.png' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Message input' }).fill('Here is the screenshot of the list.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('Here is the screenshot of the list.')).toBeVisible()

  await page.getByRole('textbox', { name: 'Message input' }).fill('And a second thought.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('And a second thought.')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Here is the screenshot of the list.')).toBeVisible()
  await expect(page.getByText('And a second thought.')).toBeVisible()
  const picture = page.locator('img[src*="/api/conversations/"]').first()
  await expect(picture).toBeVisible()
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
})
