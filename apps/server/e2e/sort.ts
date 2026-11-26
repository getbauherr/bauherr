import { expect, type Locator, type Page } from '@playwright/test'

const OVER = /is over/

export const pickUp = async (page: Page, grip: Locator) => {
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  return (await page.getByRole('status').filter({ hasText: OVER }).textContent()) ?? ''
}

export const stepUp = async (page: Page, from: string) => {
  await expect(async () => {
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('status').filter({ hasText: OVER })).not.toHaveText(from, { timeout: 1500 })
  }).toPass()
}
