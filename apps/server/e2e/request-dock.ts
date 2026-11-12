import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

export const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

export const signIn = async (page: Page, who: string) => {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

export const dock = (page: Page) => page.getByTestId('chat-dock')
export const composer = (page: Page) => dock(page).getByRole('textbox', { name: 'Message the factory' })
export const chip = (page: Page) => dock(page).getByTestId('context-chip')
export const lastAnswer = (page: Page) => dock(page).locator('[data-role=assistant]').last()

/** The end of a chat turn: the Stop button is gone (it shows while a run is going). */
export const idle = (page: Page) => expect(dock(page).getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 30_000 })

/** Sends a message and waits for the reply and for the end of its turn; the previous turn must have ended first (a message sent during a run is lost). The composer only takes text once the request thread is open (its chip shows). */
export const say = async (page: Page, text: string, reply: string | RegExp) => {
  await idle(page)
  await composer(page).fill(text)
  await composer(page).press('Enter')
  await expect(lastAnswer(page)).toContainText(reply, { timeout: 30_000 })
  await idle(page)
}

/** Waits until the new request's Product is known before anything is typed: with several Products it is picked on the card, with one the chip names it at once. A message sent earlier would get "Choose a product first". */
export const productChosen = async (page: Page, name = 'Acme Web') => {
  await expect(chip(page)).toContainText(/^New request · /, { timeout: 30_000 })
  if ((await chip(page).innerText()).includes('choose a product')) {
    await dock(page).getByTestId('product-card').getByRole('combobox', { name: 'Product' }).click()
    await page.getByRole('option', { name }).click()
  }
  await expect(chip(page)).toHaveText(`New request · ${name}`, { timeout: 30_000 })
}

/** Opens the dock in request mode with the header button and waits for the thread (the chip names the Product). */
export const startRequest = async (page: Page, chipText: string | RegExp) => {
  await page.getByRole('banner').getByRole('button', { name: 'New request' }).click()
  await expect(dock(page)).toBeVisible()
  await expect(chip(page)).toContainText(chipText, { timeout: 30_000 })
}

/** The fake interview: three answers make the draft ready, which ends in the confirmation card. */
export const interview = async (page: Page, problem: string) => {
  await say(page, problem, 'Who is affected, and since when?')
  await say(page, 'Finance, last week', 'How should it work once it is fixed?')
  await say(page, 'Totals should match', 'Anything to add before I send this?')
  await expect(dock(page).getByTestId('confirm-card').last()).toContainText('Send this request', { timeout: 30_000 })
}

export const shoot = async (page: Page, name: string, viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) => {
  const dir = process.env.SHOTS_DIR
  if (!dir) return
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${dir}/${name}-${scheme}-${vp.width}x${vp.height}.png` })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize(viewports[0]!)
}
