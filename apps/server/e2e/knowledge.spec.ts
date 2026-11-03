import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE || !process.env.E2E_FAKE_FORGE, 'set E2E_EMAIL, E2E_PASSWORD_FILE and E2E_FAKE_FORGE')

test('Knowledge: search finds a repo document, it renders, write-backs show their checks', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const main = page.getByRole('navigation', { name: 'Main' })
  await main.getByRole('link', { name: 'Knowledge' }).click()
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(main.getByRole('link', { name: 'Knowledge' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: 'handbook/release-policy.md' })).toBeVisible()

  const docs = page.getByRole('navigation', { name: 'Documents' })
  await expect(docs).toContainText('acme/web')
  await docs.getByRole('link', { name: 'docs/architecture.md' }).click()
  await expect(page.getByRole('article', { name: 'docs/architecture.md' }).getByRole('heading', { name: 'Architecture' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search Knowledge' }).fill('"previous image tag"')
  await page.getByRole('button', { name: 'Search' }).click()
  const hit = page.getByRole('region', { name: 'Search results' })
  await expect(hit.getByRole('heading')).toContainText('1 result')
  await expect(hit).toContainText('acme/knowledge · handbook/release-policy.md')
  await hit.getByRole('link', { name: 'Rollback' }).click()
  await expect(page.getByRole('article', { name: 'handbook/release-policy.md' }).getByRole('heading', { name: 'Release policy' })).toBeVisible()
  await expect(page.locator('.prose strong')).toHaveText('staging acceptance')

  const wb = page.getByRole('region', { name: 'Write-backs' })
  await expect(wb.getByRole('row', { name: /Write back: lessons from #42/ })).toContainText('× Checks failed')
  await expect(wb.getByRole('row', { name: /bauherr\/42/ })).toContainText('lint')

  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/knowledge-${scheme}-${w}x${h}.png`, fullPage: true })
      }
    }
  }
})
