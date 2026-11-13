import { expect, test } from '@playwright/test'

const button = (page: import('@playwright/test').Page) => page.getByRole('link', { name: /^Sign in with / })

test('no OIDC button by default', async ({ page }) => {
  await page.goto('/login')
  await expect(button(page)).toHaveCount(0)
  await expect(page.getByText('Use password')).toHaveCount(0)
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('OIDC button when configured', async ({ page }) => {
  test.skip(!process.env.E2E_OIDC, 'needs a server started with OIDC_* set')
  await page.goto('/login')
  await expect(button(page)).toHaveAttribute('href', '/auth/oidc/login')
  await expect(page.getByLabel('Password')).toBeHidden()
  await page.getByText('Use password').click()
  await expect(page.getByLabel('Password')).toBeVisible()
  await page.screenshot({ path: 'e2e/results/login-oidc.png' })
})

test('oidc-role refusal shows a generic message', async ({ page }) => {
  await page.goto('/login?error=oidc-role')
  await expect(page.getByRole('alert')).toHaveText('Your SSO account has no access to this Bauherr. Ask an Admin.')
})
