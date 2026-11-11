import { expect, test } from '@playwright/test'
import { give, PNG } from './paste'
import { composer, dock, signIn, startRequest } from './request-dock'
import { email } from './user'

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.CHAT_FAKE, 'needs the server started with CHAT_FAKE=1 (set CHAT_FAKE=1 here)')

test('a pasted wrong-type or oversize image shows an error in the dock composer', async ({ page }) => {
  await signIn(page, email)
  await page.getByTestId('chat-open').click()
  await expect(dock(page)).toBeVisible()
  await give(composer(page), 'paste', { name: 'notes.txt', type: 'text/plain', size: 10 })
  await expect(dock(page).getByRole('alert').filter({ hasText: 'only png, jpeg or webp images' })).toBeVisible()
  await expect(dock(page).getByTestId('attachment')).toHaveCount(0)

  const { maxBytes } = await (await page.request.post('/intake/api/media-limits', { headers: { Origin: new URL(page.url()).origin } })).json()
  await give(composer(page), 'drop', { name: 'huge.png', type: 'image/png', size: maxBytes + 1 })
  await expect(dock(page).getByTestId('attachment')).toHaveAttribute('title', /larger than \d+ MB/)
  await dock(page).getByTestId('attachment').getByRole('button', { name: 'Remove image' }).click()
  await expect(dock(page).getByTestId('attachment')).toHaveCount(0)
})

test('a pasted image in request mode is attached, uploaded and removable', async ({ page }) => {
  test.skip(!process.env.E2E_FAKE_FORGE, 'creates an Intake session, which needs the fake forge setup')
  await signIn(page, email)
  await startRequest(page, /^New request · /)
  await give(composer(page), 'paste', { name: 'shot.png', type: 'image/png', base64: PNG })
  await expect(dock(page).getByTestId('attachment').locator('img')).toBeVisible()
  await expect(dock(page).getByRole('alert')).toHaveCount(0)
  await dock(page).getByTestId('attachment').getByRole('button', { name: 'Remove image' }).click()
  await expect(dock(page).getByTestId('attachment')).toHaveCount(0)
})
