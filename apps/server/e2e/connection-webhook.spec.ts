import { expect, test } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { confirmClick } from './confirm'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const sign = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

test('Admin creates and replaces a webhook secret, and sees the delivery arrive', async ({ page }) => {
  const anonymousApiProbe = page.request
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'hooks', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/settings/connections')

  const section = page.locator('section[id^=webhook-]').filter({ hasText: 'GitHub Hooks' })
  await expect(section.getByRole('heading', { name: 'Webhook' })).toBeVisible()
  await expect(section).toContainText('Without a webhook the factory looks every minute.')
  await expect(section).toContainText('With one it reacts within seconds.')
  const unused = (await section.getByRole('button', { name: 'Create secret' }).count()) === 1
  if (unused) await expect(section).toContainText('No delivery received yet')
  await expect(section.getByText('Pull request reviews')).toBeVisible()
  const shownUrl = (await section.locator('[data-slot=alert]').first().innerText()).trim()
  expect(shownUrl).toMatch(/\/api\/hooks\/\d+$/)
  const path = new URL(shownUrl).pathname

  const shown = section.locator('[data-slot=alert]').filter({ hasText: /^[0-9a-f]{64}$/ })
  const issueSecret = async () => {
    const create = section.getByRole('button', { name: 'Create secret' })
    if (await create.count()) return create.click()
    await confirmClick(
      section.getByRole('button', { name: 'Replace secret' }),
      section.getByRole('button', { name: 'Confirm replace' }),
      (timeout) => expect(shown).toBeVisible({ timeout }),
    )
  }
  await issueSecret()
  await expect(shown).toBeVisible()
  await expect(section).toContainText('Shown once. Paste it into the webhook settings at the forge.')
  const first = (await shown.innerText()).trim()

  const body = '{"zen":"ping"}'
  const post = (secret: string) =>
    anonymousApiProbe.post(path, {
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'ping',
        'x-hub-signature-256': sign(secret, body),
      },
      data: body,
    })
  expect((await post('not-the-secret')).status()).toBe(401)
  expect((await post(first)).status()).toBe(202)

  await page.reload()
  await expect(section.getByText(/^Last delivery/)).toBeVisible()
  await expect(section).not.toContainText('No delivery received yet')
  await expect(shown).toHaveCount(0)

  await issueSecret()
  const second = (await shown.innerText()).trim()
  expect(second).not.toBe(first)
  expect((await post(first)).status()).toBe(401)
  expect((await post(second)).status()).toBe(202)
})
