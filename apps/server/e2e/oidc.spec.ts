import { expect, test } from '@playwright/test'

const button = (page: import('@playwright/test').Page) => page.getByRole('link', { name: /^Sign in with / })

test('no OIDC button by default', async ({ page }) => {
  await page.goto('/login')
  await expect(button(page)).toHaveCount(0)
})

test('OIDC button when configured', async ({ page }) => {
  test.skip(!process.env.E2E_OIDC, 'needs a server started with OIDC_* set')
  await page.goto('/login')
  await expect(button(page)).toHaveAttribute('href', '/auth/oidc/login')
  await page.screenshot({ path: 'e2e/results/login-oidc.png' })
})
