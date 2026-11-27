import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { openFromInbox } from './inbox'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
const REFERENCED = 'Brief with a decision for the tabs'
const LINKED = 'Large export needs earlier answers'

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const openTicket = async (page: Page, title: string) => {
  await openFromInbox(page, title)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

const popover = (page: Page) => page.locator('[data-slot="popover-content"]')

const expectBox = async (page: Page) => {
  await expect(popover(page)).toBeVisible()
  await expect(popover(page)).toContainText(REFERENCED)
  await expect(popover(page)).toContainText('Brief')
  await expect(popover(page).getByRole('link', { name: 'Open ticket' })).toHaveAttribute('href', /^\/tickets\/\d+$/)
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 800 }]) {
  test.describe(`ticket references at ${viewport.width}px`, () => {
    test.use({ viewport })

    test('agent text links a known number with its title and keeps an unknown one plain', async ({ page }) => {
      await signIn(page)
      await openTicket(page, 'Question to read')
      const link = page.getByRole('main').getByRole('link', { name: new RegExp(`^#\\d+ ${REFERENCED}$`) })
      await expect(link).toHaveAttribute('href', /^\/tickets\/\d+$/)
      await expect(page.getByText('#9999', { exact: false }).first()).toBeVisible()
      await expect(page.getByRole('link', { name: /#9999/ })).toHaveCount(0)
    })

    test('Tab and Enter or Space open the box, Escape closes it and focus returns', async ({ page }) => {
      await signIn(page)
      await openTicket(page, 'Question to read')
      const link = page.getByRole('main').getByRole('link', { name: new RegExp(`^#\\d+ ${REFERENCED}$`) })
      for (const key of ['Enter', 'Space']) {
        await link.focus()
        await page.keyboard.press(key)
        await expectBox(page)
        await page.keyboard.press('Escape')
        await expect(popover(page)).toHaveCount(0)
        await expect(link).toBeFocused()
      }
    })

    test('the box opens on tap or hover on the Ticket page', async ({ page }) => {
      await signIn(page)
      await openTicket(page, REFERENCED)
      await page.getByRole('heading', { level: 1 }).locator('xpath=preceding-sibling::a[1]').click()
      await expectBox(page)
      await openTicket(page, 'Build with reported steps')
      await page.getByRole('link', { name: /^Run \d+/ }).first().click()
      await expect(page.getByRole('heading', { level: 1, name: /^Run \d+$/ })).toBeVisible()
      await page.getByRole('main').getByRole('link', { name: /^#\d+$/ }).first().click()
      await expect(popover(page)).toBeVisible()
    })

    test('a finding and a note name a ticket as a link that opens the box', async ({ page }) => {
      await signIn(page)
      await openTicket(page, 'Result to read')
      const named = new RegExp(`^#\\d+ ${LINKED}$`)
      const finding = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Review findings' }) })
      await finding.getByRole('link', { name: named }).first().click()
      await expect(popover(page)).toContainText(LINKED)
      await page.keyboard.press('Escape')
      await expect(popover(page)).toHaveCount(0)
      await page.goto(`${new URL(page.url()).pathname}?tab=activity`)
      await page.getByRole('main').getByRole('link', { name: named }).first().click()
      await expect(popover(page)).toContainText(LINKED)
    })
  })
}
