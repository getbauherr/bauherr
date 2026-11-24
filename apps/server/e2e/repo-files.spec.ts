import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const ADDRESS = 'repofiles@example.com'
const PRODUCT = 'Product: Memedit App'
const url = () => process.env.BASE_URL ?? 'http://localhost:3000'

const signIn = async (page: Page) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'memedit', url: url() }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADDRESS)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const forgeCalls = async (page: Page): Promise<number> =>
  page.evaluate(async () => ((await (await fetch('/api/fake-forge')).json()) as { calls: number }).calls)

for (const size of [
  { width: 1280, height: 800 },
  { width: 375, height: 800 },
]) {
  test(
    `the Memory page lists the repository files at ${size.width} px without a call to the forge`,
    { tag: '@fake-forge' },
    async ({ page }) => {
      await page.setViewportSize(size)
      await signIn(page)
      const before = await forgeCalls(page)
      await page.goto('/memory')
      await page.getByRole('combobox', { name: 'Document' }).selectOption({ label: PRODUCT })
      const files = page.getByRole('region', { name: 'Repository files' })
      await expect(files).toContainText('AGENTS.md (42 lines)')
      await expect(files).toContainText('Handed by the factory')
      await expect(files).toContainText("Loaded by the agent's own session")
      await expect(files).toContainText('Over 200 lines')
      await expect(files).toContainText('Not loaded')
      expect(await forgeCalls(page)).toBe(before)
      await page.screenshot({ path: test.info().outputPath(`repo-files-${size.width}.png`), fullPage: true })
    },
  )
}
