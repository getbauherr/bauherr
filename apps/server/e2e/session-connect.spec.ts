import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

test('@fake-forge an agent key comes with the command, a start sentence per role and its session', async ({
  page,
  request,
}) => {
  await signIn(page)
  await page.goto('/settings/api-key')
  const connect = page.getByRole('region', { name: 'Connect a Claude Code session' })
  await expect(connect).toContainText('<agent key>')

  await page.getByLabel('Label').fill(`session ${Date.now()}`)
  await page.getByRole('button', { name: 'Create agent key' }).click()
  await expect(connect).not.toContainText('<agent key>')
  const command = await connect.getByRole('status').first().textContent()
  const key = /Bearer (bha_\w+)"/.exec(command ?? '')?.[1]
  expect(key).toBeTruthy()
  expect(command).toContain(`${new URL(page.url()).origin}/mcp`)

  const sentence = connect.getByRole('status').nth(1)
  await expect(sentence).toHaveText('Connect to bauherr as builder and work the queue.')
  await connect.getByLabel('Role').selectOption('reviewer')
  await expect(sentence).toHaveText('Connect to bauherr as reviewer and work the queue.')

  await expect(page.getByRole('region', { name: 'Sessions' })).toContainText('No session has connected yet.')
  const reply = await request.post('/mcp', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'connect', arguments: { role: 'reviewer', label: 'e2e session' } },
    },
  })
  expect(reply.ok()).toBe(true)
  const sessions = page.getByRole('region', { name: 'Sessions' })
  await expect(sessions.getByRole('row', { name: /e2e session/ })).toContainText('idle', { timeout: 30_000 })
  await expect(sessions.getByRole('row', { name: /e2e session/ })).toContainText('reviewer')
})
