import { expect, test, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { drawnPng } from '../tests/core/images'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const PO = 'po-factory@example.com'
const PLAN_WAITING = 'Export fails for large files'
const IN_PROGRESS = 'Rename report columns'
const READY_TO_TRY = 'Add target-year check'

const PIXEL = drawnPng(240, 140, [
  [0, 0, 240, 28, [30, 41, 59]],
  [16, 48, 140, 16, [37, 99, 235]],
  [16, 76, 200, 16, [203, 213, 225]],
])

const signIn = async (page: Page, address: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'factory', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(address)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const asPerson = async (browser: Browser, address: string) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await signIn(page, address)
  return page
}

const requestId = async (page: Page, title: string): Promise<string> => {
  await page.goto('/requests')
  const href = await page.getByRole('link', { name: title }).first().getAttribute('href')
  expect(href, `a request titled ${title}`).toBeTruthy()
  return href!.replace('/requests/', '')
}

const comment = async (page: Page, text: string, withPicture: boolean) => {
  const field = page.locator('#request-comment')
  await field.fill(text)
  if (withPicture) {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Add attachment' }).click()
    await (await chooser).setFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PIXEL })
    await expect(page.getByRole('button', { name: 'Remove screen.png' })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(field).toHaveValue('')
}

const pictureLoads = async (page: Page, within: string) => {
  const picture = page.locator(`${within} img[src*="/api/conversations/"]`).first()
  await expect(picture).toBeVisible()
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
}

test('a product owner comments with a picture in three states @fake-forge', async ({ browser }, testInfo) => {
  const page = await asPerson(browser, PO)
  const states = [
    [PLAN_WAITING, 'PO: should the limit be 10 MB or 50 MB?'],
    [IN_PROGRESS, 'PO: please keep the old column order'],
    [READY_TO_TRY, 'PO: the target year is missing on the second page'],
  ]
  for (const [title, text] of states) {
    await page.goto(`/requests/${await requestId(page, title!)}`)
    if (title === READY_TO_TRY) {
      await page.getByRole('button', { name: 'Not what I asked for' }).click()
      await expect(page.locator('#request-comment')).toBeFocused()
    }
    await comment(page, text!, true)
    const story = page.getByRole('region', { name: 'Story' })
    await expect(story.getByText(text!)).toBeVisible()
    await pictureLoads(page, '[aria-label="Story"]')
    if (title === PLAN_WAITING) {
      await page.screenshot({ path: testInfo.outputPath('request-comments-1280.png'), fullPage: true })
    }
  }
})

test('a comment on a waiting plan shows on the Brief card above the decision @fake-forge', async ({
  browser,
}, testInfo) => {
  const text = 'PO: please keep the export under one minute'
  const owner = await asPerson(browser, PO)
  const id = await requestId(owner, PLAN_WAITING)
  await owner.goto(`/requests/${id}`)
  await comment(owner, text, false)
  await expect(owner.getByRole('region', { name: 'Story' }).getByText(text)).toBeVisible()

  const bauherr = await asPerson(browser, email)
  await bauherr.goto(`/tickets/${id}`)
  const shown = bauherr.getByRole('region', { name: 'Conversation so far' })
  await expect(shown.getByText(text)).toBeVisible()
  await expect(shown).toContainText(PO)
  const decision = bauherr.getByTestId('action-bar')
  const above = (await shown.boundingBox())!.y < (await decision.boundingBox())!.y
  expect(above).toBe(true)
  await bauherr.screenshot({ path: testInfo.outputPath('brief-card-comment-1280.png'), fullPage: true })

  await bauherr.goto(`/tickets/${id}?tab=activity`)
  await expect(bauherr.getByText(`Comment by ${PO}: ${text}`)).toBeVisible()
})

test('a Bauherr comment on a card shows in the product owner story with name and time @fake-forge', async ({
  browser,
}) => {
  const text = 'Bauherr: the PDF export is out of scope here'
  const bauherr = await asPerson(browser, email)
  const owner = await asPerson(browser, PO)
  const id = await requestId(owner, PLAN_WAITING)
  await bauherr.goto(`/tickets/${id}`)
  await comment(bauherr, text, false)
  await expect(bauherr.getByRole('region', { name: 'Conversation so far' }).getByText(text)).toBeVisible()

  await owner.goto(`/requests/${id}`)
  const entry = owner.getByRole('region', { name: 'Story' }).locator('[data-event="comment"]', { hasText: text })
  await expect(entry).toContainText(email)
  await expect(entry.locator('span[title]')).toHaveText(/\d\d:\d\d/)
})
