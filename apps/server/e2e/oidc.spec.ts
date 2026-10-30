import { expect, test } from '@playwright/test'

// Run against a server started with OIDC_ISSUER set to assert the button; without it, assert absence.
test('OIDC button follows OIDC_ISSUER', async ({ page }) => {
  await page.goto('/login')
  const button = page.getByRole('link', { name: /^Sign in with / })
  if (process.env.E2E_OIDC === '1') {
    await expect(button).toHaveAttribute('href', '/auth/oidc/login')
    await page.screenshot({ path: 'e2e/results/login-oidc.png' })
  } else {
    await expect(button).toHaveCount(0)
  }
})
