import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { inboxHref } from './inbox'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const say = async (page: Page, text: string) => {
  const composer = page.locator('.aui-composer-input')
  await composer.fill(text)
  await composer.press('Enter')
}

test(
  'the composer answers a question and turns a request into an intent that Undo cancels',
  { tag: '@fake-forge' },
  async ({ page }) => {
    await signIn(page)
    const href = await inboxHref(page, /Question to steer from the composer 1/)
    await page.goto(href.replace('/tickets/', '/inbox?t='))
    const composer = page.locator('.aui-composer-input')
    await expect(composer).toHaveAttribute('placeholder', /Tell the factory what to do with #\d+/)
    const stamp = Date.now()
    await say(page, `Why was this asked ${stamp}?`)
    await expect(page.getByText('Because the first answer was a draft.').first()).toBeVisible()
    await say(page, `Skip the email checks ${stamp}`)
    const receipt = page.getByRole('status').filter({ hasText: 'Passed to the agent' })
    const words = page.getByLabel('Words for the agent')
    await expect(words).toHaveValue(`Skip the email checks ${stamp}`)
    await expect(receipt).toHaveCount(0)
    await page.getByRole('button', { name: 'Pass to the agent' }).click()
    await expect(receipt).toBeVisible()
    await receipt.getByRole('button', { name: 'Undo' }).click()
    await expect(receipt).toHaveCount(0)
    await expect(page.getByText('Undone. Nothing was written.').first()).toBeVisible()
    await page.reload()
    await expect(page.getByText('Because the first answer was a draft.').first()).toBeVisible()
    await expect(page.getByText('You asked me to pass this to the agent working on').first()).toBeVisible()
  },
)
