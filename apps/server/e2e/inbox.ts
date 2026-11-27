import type { Page } from '@playwright/test'

export const inboxRow = (page: Page, title: string | RegExp) =>
  page.locator('[data-inbox-row]').filter({ hasText: title }).first()

export const inboxHref = async (page: Page, title: string | RegExp): Promise<string> => {
  await page.goto('/inbox')
  const href = await inboxRow(page, title).locator('a[href^="/tickets/"]').first().getAttribute('href')
  if (href === null) throw new Error(`No Inbox row titled ${String(title)}`)
  return href
}

export const openFromInbox = async (page: Page, title: string | RegExp): Promise<void> => {
  await page.goto(await inboxHref(page, title))
}
