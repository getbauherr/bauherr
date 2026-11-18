import { expect, type Page } from '@playwright/test'

const hydrated = (page: Page) =>
  (page.viewportSize()?.width ?? 1280) >= 1100
    ? expect(page.getByTestId('inbox-split')).toHaveAttribute('data-wide', 'true')
    : page.waitForFunction(() => Object.keys(document.querySelector('[data-testid=inbox-split]') ?? {}).some((k) => k.startsWith('__reactFiber')))

export const pickRow = async (page: Page, title?: string) => {
  await hydrated(page)
  const rows = page.getByTestId('inbox-row')
  await (title ? rows.filter({ hasText: title }) : rows.first()).click()
}
