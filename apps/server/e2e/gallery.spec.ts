import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { email } from './user'

const TITLE = 'Brief with a mockup'
const PICTURES = 3
const SHOTS = '/tmp/claude-1000/m809'

const openBrief = async (page: Page) => {
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
}

const swipe = async (page: Page, from: number, to: number) => {
  const cdp = await page.context().newCDPSession(page)
  const y = 400
  const touch = (type: string, x: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  await touch('touchStart', from)
  await touch('touchMove', (from + to) / 2)
  await touch('touchMove', to)
  await touch('touchEnd', to)
}

test.describe('gallery on a phone', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true })

  test('fills the screen, swipes to the next picture and labels its buttons', async ({ page }) => {
    await openBrief(page)
    await page.getByRole('button', { name: 'Export page, new: progress bar' }).tap()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(`1 of ${PICTURES}`)).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeCloseTo(0, 0)
    expect(box!.y).toBeCloseTo(0, 0)
    expect(box!.width).toBeCloseTo(375, 0)
    expect(box!.height).toBeCloseTo(740, 0)
    for (const name of ['Previous', 'Next', 'Close']) {
      await expect(dialog.getByRole('button', { name })).toBeVisible()
      await expect(dialog.getByRole('button', { name })).toHaveText(name)
    }
    await swipe(page, 300, 60)
    await expect(dialog.getByText(`2 of ${PICTURES}`)).toBeVisible()
    await swipe(page, 60, 300)
    await expect(dialog.getByText(`1 of ${PICTURES}`)).toBeVisible()
  })
})

test.describe('gallery on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('shows a tall picture whole in Fit to screen and at natural height in Actual size', async ({ page }) => {
    await openBrief(page)
    await page.getByRole('button', { name: 'Export page, full length' }).click()
    const dialog = page.getByRole('dialog')
    const picture = dialog.getByRole('img', { name: 'Export page, full length' })
    await expect(picture).toHaveJSProperty('naturalHeight', 2450)
    mkdirSync(SHOTS, { recursive: true })

    const fit = await picture.boundingBox()
    expect(fit!.y).toBeGreaterThanOrEqual(0)
    expect(fit!.y + fit!.height).toBeLessThanOrEqual(720)
    expect(fit!.height).toBeLessThan(720)
    await page.screenshot({ path: `${SHOTS}/fit.png` })

    await dialog.getByRole('button', { name: 'Fit to screen' }).click()
    await expect(dialog.getByRole('button', { name: 'Actual size' })).toBeVisible()
    const actual = await picture.boundingBox()
    expect(Math.round(actual!.height)).toBe(2450)
    await page.screenshot({ path: `${SHOTS}/actual.png` })

    await picture.click()
    await expect(dialog.getByRole('button', { name: 'Fit to screen' })).toBeVisible()
  })

  test('Escape returns focus to the clicked thumbnail', async ({ page }) => {
    await openBrief(page)
    const thumbnail = page.getByRole('button', { name: 'Export page, new: finished state' })
    await thumbnail.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(`2 of ${PICTURES}`)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(thumbnail).toBeFocused()
  })

  test('Tab reaches Previous, Next, the Fit toggle, Open in new tab and Close', async ({ page }) => {
    await openBrief(page)
    await page.getByRole('button', { name: 'Export page, new: progress bar' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(`1 of ${PICTURES}`)).toBeVisible()
    const reached: string[] = []
    for (let i = 0; i < 5; i++) {
      reached.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''))
      await page.keyboard.press('Tab')
    }
    expect(reached).toEqual(['Previous', 'Next', 'Fit to screen', 'Open in new tab', 'Close'])
  })
})
