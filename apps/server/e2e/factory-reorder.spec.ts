import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const OWN = /^Reorder (first|second)$/

const enter = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/')
}

test('a card moved up with the keyboard stays there after a reload', async ({ page }) => {
  await enter(page)
  const intake = page.getByRole('region', { name: 'Intake' })
  const order = () => intake.getByRole('link', { name: OWN }).allTextContents()
  await expect(intake.getByRole('link', { name: OWN })).toHaveCount(2)
  const [upper, lower] = await order()
  await intake.getByRole('link', { name: lower }).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toContainText(lower!)
  await expect(intake.getByRole('link', { name: lower })).toBeFocused()
  expect(await order()).toEqual([lower, upper])
  await page.reload()
  await expect(intake.getByRole('link', { name: OWN })).toHaveCount(2)
  expect(await order()).toEqual([lower, upper])
})
