import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { inboxHref } from './inbox'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page, address: string) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(address)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const requestPath = async (page: Page, title: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await signIn(page, email)
  const href = await inboxHref(page, new RegExp(title))
  return href.replace('/tickets/', '/requests/')
}

test('a plan that waits shows the Now box, the story and its pictures', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(await requestPath(page, 'Brief with a mockup'))
  const now = page.getByRole('region', { name: 'Now' })
  await expect(now).toContainText('waits for approval by a Bauherr')
  await expect(now).toContainText("A Bauherr's turn")
  await expect(page.getByText('Plan waiting for approval')).toBeVisible()
  await expect(page.getByText('Request sent')).toBeVisible()
  await expect(page.getByText('The plan', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('What will be checked')).toBeVisible()
  await expect(page.getByRole('button', { name: /Open image: Export page, new: progress bar/ })).toBeVisible()
  await expect(page.getByText(/\b(runs?|cost|agents?)\b/i)).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('request-plan-waiting-1280.png'), fullPage: true })
})

test('a result that is ready shows the Now box asking to try it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(await requestPath(page, 'Result to read'))
  await expect(page.getByRole('region', { name: 'Now' })).toContainText('Try it on staging')
  await expect(page.getByText('Ready to try', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('request-ready-1280.png'), fullPage: true })
})

test('a Product owner of another product gets not found, with no ticket data', async ({ page, context }) => {
  const path = await requestPath(page, 'Brief with a mockup')
  await context.clearCookies()
  await signIn(page, 'owner@example.com')
  const response = await page.goto(path)
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Brief with a mockup')).toHaveCount(0)
})
