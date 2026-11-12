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

/** Light and dark screenshots of the page at the given sizes into `SHOTS_DIR` (nothing without it). */
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
