import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const enter = async (page: Page, path: string) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'insights', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
  await page.goto(path)
}

const figure = (page: Page, label: string) => page.locator('dl > div', { hasText: label }).locator('dd')

test('Insights shows the summary, the time bars and the cost of the tickets done in the range', async ({ page }) => {
  await enter(page, '/insights')
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible()
  await expect(page.getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'true')
  await expect(figure(page, 'tickets done')).toHaveText('3')
  const bars = page.getByRole('list', { name: 'Time per stage' })
  await expect(bars.getByRole('img', { name: /^Brief: .*Waiting on you/ })).toBeVisible()
  await expect(bars.getByRole('img', { name: /^Build: .*Agent working/ })).toBeVisible()
  await expect(page.getByText(/is the largest share in/)).toBeVisible()
  const cost = page.getByRole('table', { name: 'Cost by stage' })
  await expect(cost.getByRole('row', { name: /^Build 4 3 / })).toBeVisible()
  await expect(cost.getByRole('row', { name: /^Total / })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Most expensive tickets' })).toContainText('Add target-year check')
  await page.getByRole('link', { name: '7 days' }).click()
  await expect(page).toHaveURL(/days=7/)
  await expect(figure(page, 'tickets done')).toHaveText('2')
})

test('a ticket shows its time and cost in the side column', async ({ page }) => {
  await enter(page, '/insights')
  const top = page.getByRole('table', { name: 'Most expensive tickets' })
  await top.getByRole('link', { name: /Add target-year check/ }).click()
  const box = page.locator('section', { has: page.getByRole('heading', { name: 'Time and cost' }) })
  await expect(box.getByText('Issue to done')).toBeVisible()
  await expect(box.getByText('Waiting on you')).toBeVisible()
  await expect(box.getByText('5 of 5 runs measured')).toBeVisible()
})

test('a memory shows what coming back cost', async ({ page }) => {
  await enter(page, '/memory/statements')
  await page.getByRole('link', { name: 'Check the year of every date.' }).click()
  const box = page.locator('section', { has: page.getByRole('heading', { name: 'Cost of coming back' }) })
  await expect(box).toContainText('1 extra round')
  await expect(box).toContainText('1 ticket')
})
