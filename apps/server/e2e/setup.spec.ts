import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = process.env.E2E_EMAIL!
const shots = process.env.SHOTS_DIR
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 and INTAKE_FAKE=1 (set E2E_FAKE_FORGE=1 here)')
test.describe.configure({ mode: 'serial' })

const signIn = async (page: Page, as = email) => {
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'newco', url: process.env.BASE_URL ?? 'http://localhost:3000' }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(as)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('header.topbar')).toBeVisible()
}
const shoot = async (page: Page, name: string) => {
  if (!shots) return
  for (const [w, h] of [[1280, 800], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.screenshot({ path: `${shots}/setup-${name}-${scheme}-${w}.png`, fullPage: true })
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 })
}
const step = (page: Page, name: string) => expect(page.getByRole('heading', { name, level: 2 })).toBeVisible()
const word = (page: Page, label: string, w: 'Done' | 'To do') => expect(page.getByRole('list', { name: 'Setup' }).getByRole('listitem').filter({ hasText: label })).toContainText(w)

test('a Member who is not Admin is asked to get an Admin', async ({ page }) => {
  await signIn(page, 'setup-member@example.com')
  await page.goto('/setup')
  await expect(page.getByText('Ask an Admin to finish setup.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
})

test('an empty Workspace links to /setup and the Admin walks all four steps to a Ticket in Triage', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Set up your Workspace' }).click()
  await expect(page).toHaveURL(/\/setup$/)
  await page.goto('/requests/new')
  await expect(page.getByRole('link', { name: 'Set up your Workspace' })).toBeVisible()
  await page.goto('/setup')

  await step(page, 'Connect GitHub')
  for (const l of ['Connect GitHub', 'Add the first Product', 'Staging and gates', 'First request']) await word(page, l, 'To do')
  await shoot(page, '1-connect')
  await page.getByLabel('Name', { exact: true }).fill('GitHub Newco')
  await page.getByLabel('Secret').fill('ghp_e2e_dummy')
  await page.getByRole('button', { name: 'Add Connection' }).click()
  await expect(page.getByText('Not verified yet.')).toBeVisible()
  await page.reload()
  await step(page, 'Connect GitHub')
  await page.getByRole('button', { name: 'Verify', exact: true }).click()

  await step(page, 'Add the first Product')
  await word(page, 'Connect GitHub', 'Done')
  await page.reload()
  await step(page, 'Add the first Product')
  await shoot(page, '2-product')

  // A failing create leaves no half-created Product: drop the client-side required flag so the repository create fails.
  await page.getByLabel('Product name').fill('Rollback Probe')
  await page.getByLabel('Repository').evaluate((el: HTMLInputElement) => el.removeAttribute('required'))
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page.getByRole('alert').first()).toBeVisible()
  expect(((await (await page.request.get('/api/products?where[name][equals]=Rollback%20Probe&depth=0')).json()).docs as unknown[]).length).toBe(0)

  await page.getByLabel('Product name').fill('Newco Shop')
  await page.getByLabel('Repository').fill('newco/shop')
  await page.getByRole('button', { name: 'Add Product' }).click()
  await step(page, 'Staging')
  await word(page, 'Add the first Product', 'Done')
  await shoot(page, '3-deploy')
  await page.waitForTimeout(1100) // "saved" means updated at least a second after creation
  await page.getByRole('button', { name: 'Skip, use defaults' }).click()

  await word(page, 'Staging and gates', 'Done')
  await page.goto('/setup?step=deploy')
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Skip, use defaults' })).toHaveCount(0)
  await page.goto('/setup')
  await expect(page.getByLabel('Product')).toContainText('Newco Shop')
  await page.reload()
  await expect(page.getByLabel('Product')).toContainText('Newco Shop')
  await shoot(page, '4-request')

  const say = async (text: string, reply: string) => {
    await page.getByLabel(/Describe your request|Your answer/).fill(text)
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('[data-role=assistant]').last()).toHaveText(reply)
  }
  await say('The invoice total is wrong', 'Who is affected, and since when?')
  await say('Finance, last week', 'How should it work once it is fixed?')
  await say('Totals should match', 'Anything to add before I send this?')
  await page.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByRole('status')).toContainText('waits in Triage')

  await page.goto('/setup')
  for (const l of ['Connect GitHub', 'Add the first Product', 'Staging and gates', 'First request']) await word(page, l, 'Done')
  await expect(page.getByRole('status').filter({ hasText: 'Your Workspace is set up.' })).toBeVisible()
  await shoot(page, '5-done')
})
