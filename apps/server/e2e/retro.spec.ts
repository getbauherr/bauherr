import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const startRetro = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'retro', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill('retro-bauherr@example.com')
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto('/memory/retro')
  await expect(page.getByRole('heading', { level: 1, name: /Start a Retro/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'What this range holds' })).toContainText('4 tickets accepted')
  await page.getByRole('button', { name: 'Start Retro' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /^Retro:/ })).toBeVisible()
}

const agreed = (page: Page) => page.getByRole('region', { name: 'Agreed so far' })

test('a Retro opens with the figures, the far-off ticket and a proposal with evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await startRetro(page)
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Verify rounds per ticket').first()).toBeVisible()
  const table = page.getByRole('table', { name: 'Tickets far off the others' })
  await expect(table.getByRole('row', { name: /Rebuild the export dialog/ })).toBeVisible()
  await expect(page.getByText('Should a change that is sent back twice get a mockup before Build?')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Rebuild the export dialog' }).last()).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('retro-opening-1280.png'), fullPage: true })
})

test('accepting a proposal and answering make the agreed list grow, each with its level', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await startRetro(page)
  await expect(agreed(page)).toContainText('Nothing agreed yet')
  await page.getByRole('button', { name: 'Accept' }).click()
  await expect(agreed(page).getByRole('listitem')).toHaveCount(1)
  await expect(agreed(page)).toContainText('Product')
  await page.getByLabel('Answer the factory or ask a question').fill('Yes, and answered questions must not come back.')
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(agreed(page).getByRole('listitem')).toHaveCount(2)
  await expect(agreed(page)).toContainText('Workspace')
  await page.screenshot({ path: test.info().outputPath('retro-agreed-1280.png'), fullPage: true })
})
