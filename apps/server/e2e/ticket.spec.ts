import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const shots = process.env.SHOTS_DIR

const login = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
}

// [slug, Ticket title, primary verb ('' = none)]. Runs before the test that approves the plan of #1.
const STATES = [
  ['answer-decisions', 'Add a dark theme to the dashboard', 'Answer decisions'],
  ['answer-questions', 'Clarify the export scope', 'Answer questions'],
  ['approve-plan', 'Tidy the settings copy', 'Approve plan'],
  ['accept-staging', 'Ship the export header', 'Accept on staging'],
  ['approve-production', 'Ship the gated header', 'Approve production'],
  ['round-cap', 'Harden the retry loop', 'Grant one more round'],
  ['run-failed', 'Fix the date parser', 'Re-run build'],
  ['none', 'Export invoices as CSV', ''],
] as const

test('the action bar is the same single, visible bar in every state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await login(page)
  let y: number | null = null
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const [slug, title, verb] of STATES) {
      await page.goto('/')
      await page.locator('.card', { hasText: title }).first().getByRole('link', { name: title }).click()
      const bar = page.getByTestId('action-bar')
      await expect(bar).toBeVisible()
      await expect(page.getByTestId('action-bar')).toHaveCount(1)
      await expect(bar.locator('.btn.primary')).toHaveCount(verb ? 1 : 0)
      if (verb) await expect(bar.locator('.btn.primary')).toHaveText(verb)
      await expect(bar.locator('.btn')).not.toHaveCount(3)
      const box = (await bar.boundingBox())!
      if (viewport.width > 640) {
        y ??= box.y
        expect(box.y).toBe(y)
      } else {
        expect(Math.round(box.y + box.height)).toBe(viewport.height)
      }
      if (shots) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme })
          await page.screenshot({ path: `${shots}/action-bar-${slug}-${scheme}-${viewport.width}x${viewport.height}.png` })
        }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('answer the critical decision, then approve the plan', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()

  const row = page.locator('.card', { hasText: 'Add a dark theme to the dashboard' }).first()
  await expect(row.getByText('Answer decisions')).toBeVisible()
  await row.getByRole('link', { name: 'Add a dark theme to the dashboard' }).click()

  await expect(page.locator('.sheet tbody tr')).toHaveCount(2)
  await expect(page.getByText('★ critical')).toHaveCount(1)
  const bar = page.getByTestId('action-bar')
  const approve = bar.getByRole('button', { name: 'Approve plan' })
  await expect(bar.getByRole('link', { name: 'Answer decisions' })).toBeVisible()
  await expect(approve).toHaveCount(0)

  await page.getByRole('radio', { name: 'yes, until the user picks' }).check()
  await page.getByRole('button', { name: 'Save answers' }).click()
  await expect(approve).toBeVisible()
  await expect(page.locator('#worklog')).toBeVisible()
  await expect(page.getByText('D2 Follow the system setting: yes, until the user picks')).toBeVisible()

  await approve.click()
  await expect(page.getByText('✓ Plan approved')).toBeVisible()
  await expect(approve).toHaveCount(0)
})
