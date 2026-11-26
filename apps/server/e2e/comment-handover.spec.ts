import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const PO = 'po-handover@example.com'
const TITLE = 'Rename the handover column'
const COMMENT = 'PO: please keep the old column order'

const signIn = async (page: Page, address: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'handover', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(address)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const agentKey = async (page: Page): Promise<string> => {
  await page.goto('/settings/api-key')
  const connect = page.getByRole('region', { name: 'Connect a Claude Code session' })
  await page.getByLabel('Label').fill(`handover ${Date.now()}`)
  await page.getByRole('button', { name: 'Create agent key' }).click()
  await expect(connect).not.toContainText('<agent key>')
  const command = await connect.getByRole('status').first().textContent()
  const key = /Bearer (bha_\w+)"/.exec(command ?? '')?.[1]
  expect(key).toBeTruthy()
  return key!
}

type Answer = { status?: string; runId: number; leaseToken: string; session: string; referenceData: Delivered }
type Delivered = { newComments: { text: string }[] }

const tool = async (request: APIRequestContext, key: string, name: string, args: object) => {
  const reply = await request.post('/mcp', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  expect(reply.ok()).toBe(true)
  const body = (await reply.json()) as { result: { content: { text: string }[]; isError?: boolean } }
  expect(body.result.isError ?? false).toBe(false)
  return JSON.parse(body.result.content[0]!.text) as Answer
}

test('a comment handed over by a heartbeat shows Seen by the team @fake-forge', async ({
  browser,
  request,
}, testInfo) => {
  const admin = await (await browser.newContext()).newPage()
  await signIn(admin, email)
  const key = await agentKey(admin)
  const connect = { role: 'builder', label: 'handover', clientSession: 'handover-1' }
  const { session } = await tool(request, key, 'connect', connect)
  const work = await tool(request, key, 'next_work', { session })
  expect(work.status).toBe('work')
  const ids = { runId: work.runId, leaseToken: work.leaseToken }

  const owner = await (await browser.newContext()).newPage()
  await owner.setViewportSize({ width: 1280, height: 900 })
  await signIn(owner, PO)
  await owner.goto('/requests')
  await owner.getByRole('link', { name: TITLE }).first().click()
  await owner.locator('#request-comment').fill(COMMENT)
  await owner.getByRole('button', { name: 'Send' }).click()
  const entry = owner.getByRole('region', { name: 'Story' }).locator('[data-event="comment"]', { hasText: COMMENT })
  await expect(entry).toBeVisible()
  await expect(entry.locator('[data-seen]')).toHaveCount(0)

  const answer = await tool(request, key, 'heartbeat', { ...ids, step: 'reading the plan' })
  expect(answer.referenceData.newComments.map((c) => c.text)).toEqual([COMMENT])
  expect((await tool(request, key, 'heartbeat', ids)).referenceData.newComments).toEqual([])

  await owner.reload()
  await expect(entry.locator('[data-seen]')).toHaveText(/Seen by the team · \d\d:\d\d/)
  await owner.screenshot({ path: testInfo.outputPath('seen-by-the-team-1280.png'), fullPage: true })
})
