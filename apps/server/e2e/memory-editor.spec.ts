import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const PRODUCT = 'Product: Memedit App'
const url = () => process.env.BASE_URL ?? 'http://localhost:3000'

const signIn = async (page: Page, address: string) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'memedit', url: url() }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(address)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/memory')
  await expect(page.getByRole('heading', { name: 'Memory', level: 1 })).toBeVisible()
}

const versionCount = (page: Page) => page.getByRole('button', { name: /what changed in v\d+/ }).count()

const save = async (page: Page, before: number) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(() => versionCount(page)).toBeGreaterThan(before)
}

const shoot = async (page: Page, name: string) => {
  const width = page.viewportSize()?.width
  await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true })
}

test('a product owner may not save the factory document and is told why', async ({ page }) => {
  await signIn(page, 'memedit-bauherr@example.com')
  await page.getByLabel('Document').selectOption({ label: 'Factory' })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(page.getByText('Only an Admin changes the factory document.')).toBeVisible()
  await page.getByLabel('Document').selectOption({ label: PRODUCT })
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
})

test('two saves make two versions and an older version shows what changed in green and red', async ({ page }) => {
  const token = `Check ${Date.now()}`
  await signIn(page, email)
  await page.getByLabel('Document').selectOption({ label: PRODUCT })
  const editor = page.locator('.cm-content')
  await expect(editor).toContainText('Use pnpm for every script.')
  const before = await versionCount(page)
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(token)
  await expect(page.getByText(/\d+ \/ 200 lines/)).toBeVisible()
  await save(page, before)
  await expect(editor).toContainText(token)
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  await save(page, before + 1)
  await page.getByRole('button', { name: `Show what changed in v${before + 1}` }).click()
  await expect(page.locator('[data-kind="added"]', { hasText: token })).toBeVisible()
  await page.getByRole('button', { name: `Show what changed in v${before + 2}` }).click()
  await expect(page.locator('[data-kind="removed"]', { hasText: token })).toBeVisible()
})

for (const size of [
  { width: 1280, height: 800 },
  { width: 375, height: 800 },
]) {
  test(`the page works at ${size.width} px, with the side column below the editor on a phone`, async ({ page }) => {
    await page.setViewportSize(size)
    await signIn(page, email)
    await page.getByLabel('Document').selectOption({ label: PRODUCT })
    await expect(page.locator('.cm-content')).toContainText('Use pnpm for every script.')
    const editor = await page.getByRole('tabpanel', { name: 'Write' }).boundingBox()
    const side = await page.getByRole('complementary', { name: 'About this document' }).boundingBox()
    if (size.width < 1024) {
      expect(side!.y).toBeGreaterThanOrEqual(editor!.y + editor!.height)
    } else {
      expect(side!.x).toBeGreaterThanOrEqual(editor!.x + editor!.width)
    }
    const { violations } = await new AxeBuilder({ page }).exclude('nextjs-portal').analyze()
    expect(violations.map((v) => v.id)).toEqual([])
    await shoot(page, 'memory')
    await page.getByRole('tab', { name: 'Preview' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Preview' })).toContainText('Use pnpm for every script.')
    await shoot(page, 'memory-preview')
  })
}

test('the editor can be used with the keyboard alone', async ({ page }) => {
  await signIn(page, email)
  await page.getByLabel('Document').selectOption({ label: PRODUCT })
  await page.getByRole('tab', { name: 'Preview' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Bold' })).toBeFocused()
})
