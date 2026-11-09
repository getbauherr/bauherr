import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { confirmClick } from './confirm'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE || !process.env.E2E_FAKE_FORGE, 'set E2E_EMAIL, E2E_PASSWORD_FILE and E2E_FAKE_FORGE')

const TECHNICAL = /\b[0-9a-f]{7}\b|\.md\b|bauherr\/|pull request|acme\/(knowledge|web)/i

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
  await expect(page.getByRole('navigation', { name: 'Documents' }).getByRole('link', { name: 'Release policy' })).toBeVisible()

  const docs = page.getByRole('navigation', { name: 'Documents' })
  await expect(docs).toContainText('Acme Web')
  await docs.getByRole('link', { name: 'Architecture' }).click()
  await expect(page.getByRole('article', { name: 'Architecture' }).getByRole('heading', { name: 'Architecture' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search Knowledge' }).fill('"previous image tag"')
  await page.getByRole('button', { name: 'Search' }).click()
  const hit = page.getByRole('region', { name: 'Search results' })
  await expect(hit.getByRole('heading')).toContainText('1 result')
  await hit.getByRole('link', { name: 'Rollback' }).click()
  await expect(page.getByRole('article', { name: 'Release policy' }).getByRole('heading', { name: 'Release policy' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Release policy' }).locator('strong')).toHaveText('staging acceptance')

  const wb = page.getByRole('region', { name: 'Write-backs' })
  await expect(wb.getByRole('row', { name: /Write back: lessons from #42/ })).toContainText('× Checks failed')
  await expect(wb.getByRole('row', { name: /bauherr\/42/ })).toContainText('lint')

  await expect(page.getByRole('article', { name: 'Release policy' })).not.toContainText(TECHNICAL)
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/knowledge-admin-${scheme}-${w}x${h}.png`, fullPage: true })
      }
    }
  }
})

test('Knowledge: a member sees titles only, no Built-in documents, no Write-backs and no technical metadata', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('member@example.com')
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
  await page.goto('/knowledge')
  const docs = page.getByRole('navigation', { name: 'Documents' })
  await expect(docs.getByRole('link', { name: 'Release policy' })).toBeVisible()
  await expect(docs).not.toContainText('Built-in')
  await expect(docs).toContainText('Your Knowledge')
  await expect(page.getByRole('region', { name: 'Write-backs' })).toHaveCount(0)
  await docs.getByRole('link', { name: 'Release policy' }).click()
  await expect(page.getByRole('article', { name: 'Release policy' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Release policy' })).not.toContainText(TECHNICAL)
  await page.getByRole('searchbox', { name: 'Search Knowledge' }).fill('"previous image tag"')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText(TECHNICAL)
  await page.goto('/knowledge?doc=core:rules/evidence.md')
  await expect(page.getByRole('article')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('evidence')
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/knowledge-member-${scheme}-${w}x${h}.png`, fullPage: true })
      }
    }
  }
})

test('Knowledge: an Admin sees a skill proposal with its scores and approves it', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
  await page.goto('/knowledge')
  const region = page.getByRole('region', { name: 'Skill proposals' })
  const row = region.getByRole('row', { name: /tdd-first/ })
  await expect(row).toContainText('Replayed')
  await expect(row).toContainText('100% vs 50%')
  await expect(row.getByRole('link', { name: '#2' })).toBeVisible()
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/skill-proposals-${scheme}-${w}x${h}.png`, fullPage: true })
      }
    }
  }
  await confirmClick(row.getByRole('button', { name: 'Approve' }), row.getByRole('button', { name: /Confirm: merge/ }), (timeout) => expect(row).toContainText('Accepted', { timeout }))
  await expect(row.getByRole('button')).toHaveCount(0)
})
