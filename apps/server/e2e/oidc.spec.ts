import { expect, test } from '@playwright/test'

const button = (page: import('@playwright/test').Page) => page.getByRole('link', { name: /^Sign in with / })

test('no OIDC button by default', async ({ page }) => {
  await page.goto('/login')
  await expect(button(page)).toHaveCount(0)
  await expect(page.getByText('Use password')).toHaveCount(0)
  await expect(page.getByLabel('Password')).toBeVisible()
})

test.describe('with the fake OIDC provider', { tag: '@oidc' }, () => {
  test.use({ baseURL: process.env.E2E_OIDC })

  test('OIDC button when configured', async ({ page }) => {
    await page.goto('/login')
    await expect(button(page)).toHaveAttribute('href', '/auth/oidc/login')
    await expect(page.getByLabel('Password')).toBeHidden()
    await page.getByText('Use password').click()
    await expect(page.getByLabel('Password')).toBeVisible()
    await page.screenshot({ path: 'e2e/results/login-oidc.png' })
  })

  test('a Product owner signs in through OIDC and lands on Requests', async ({ page }) => {
    await page.goto('/login')
    await button(page).click()
    await expect(page).toHaveURL(/\/requests$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Factory App')
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Requests'])
  })
})

test('oidc-role refusal shows a generic message', async ({ page }) => {
  await page.goto('/login?error=oidc-role')
  await expect(
    page.getByRole('alert').filter({ hasText: 'Your SSO account has no access to this Bauherr. Ask an Admin.' }),
  ).toBeVisible()
})
