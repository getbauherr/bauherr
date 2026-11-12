import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()
test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

/** Seeded in a Workspace of its own (`po-lab`, seed-e2e.ts): Lab Alpha (assigned) and Lab Beta, each with one Ticket, one sent request and one review artifact. Only this spec signs in as these two users. */
const owner = 'po-view@example.com'
const bauherr = 'po-view-bauherr@example.com'

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' })
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true })
}

const signIn = async (page: Page, who: string, home: RegExp) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(home)
}

/** Fetched from inside the page, so the call carries the browser's session like the app's own requests do. */
const call = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const r = await fetch(p)
    return { status: r.status, body: (await r.json().catch(() => null)) as { docs?: { id: number }[]; label?: string } | null }
  }, path)

const idOf = async (page: Page, collection: string, field: string, value: string) => {
  const found = (await call(page, `/api/${collection}?where[${field}][equals]=${encodeURIComponent(value)}&depth=0&limit=1`)).body?.docs?.[0]?.id
  expect(found, `${collection} ${value}`).toBeTruthy()
  return found!
}

test('a Product owner works in Requests: home, own Product, no factory internals, nothing of Product B', async ({ page, browser, baseURL }) => {
  const control = await (await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, colorScheme: 'light' })).newPage()
  await signIn(control, bauherr, /\/$/)
  const alphaTicket = await idOf(control, 'tickets', 'externalId', 'e2e-lab-alpha-1')
  const betaTicket = await idOf(control, 'tickets', 'externalId', 'e2e-lab-beta-1')
  const betaRequest = await idOf(control, 'intake_sessions', 'title', 'Lab Beta request')
  const betaArtifact = await idOf(control, 'artifacts', 'title', 'Lab Beta report')
  const alphaArtifact = await idOf(control, 'artifacts', 'title', 'Lab Alpha report')

  await signIn(page, owner, /\/requests$/)
  const main = page.getByRole('main')
  await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText([/^Requests/, 'Profile']) // the first one carries the draft count
  await expect(page.getByRole('navigation', { name: 'Account' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(0)

  // The four sections: A's sent request is in the factory, their draft is a draft, B's request is nowhere.
  await expect(page.getByTestId('count-factory')).toHaveText('1')
  await expect(page.getByTestId('factory-rows')).toContainText('Lab Alpha request')
  await expect(page.getByTestId('draft')).toContainText('Lab Alpha draft')
  await expect(page.getByTestId('count-drafts')).toHaveText('1')
  await expect(main).not.toContainText('Lab Beta')
  await expect(main.getByText('Decide on the fast lane')).toHaveCount(0)
  await shot(page, 'po-requests')

  // The request: card, plain-word timeline, who it waits for, the comment stream from the forge.
  await page.getByRole('link', { name: 'Lab Alpha request' }).click()
  await expect(page.getByRole('heading', { name: 'Lab Alpha request', level: 1 })).toBeVisible()
  await expect(page.getByTestId('timeline-entry').first()).toContainText('Sent')
  await expect(page.getByTestId('request-comment').filter({ hasText: 'Please check the contrast of the new header.' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/waits for/).first()).toBeVisible()

  // The reduced Ticket page: no Runs, steps, cost, model, plan or settings; proof and the plain path are there.
  await page.getByRole('link', { name: '#1 Lab Alpha ticket' }).click()
  await expect(page).toHaveURL(new RegExp(`/tickets/${alphaTicket}$`))
  const ticket = page.getByTestId('owner-ticket')
  await expect(ticket.getByRole('heading', { name: '#1 Lab Alpha ticket', level: 1 })).toBeVisible()
  await expect(ticket.getByTestId('request-headline')).toBeVisible()
  await expect(ticket.getByTestId('progress-path')).toBeVisible()
  await expect(ticket.getByTestId('request-comment').filter({ hasText: 'Please check the contrast' })).toBeVisible({ timeout: 30_000 })
  await expect(ticket.getByRole('button', { name: 'Comment on #1' })).toBeVisible()
  for (const heading of ['Runs', 'Steps', 'Plan', 'Worklog', 'Path', 'Details']) await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0)
  await expect(main).not.toContainText(/claude-lab-secret-model|1\.234|\$|tokens|budget|executor|Run #|Fix state|Expedite/i)
  await expect(page.getByRole('link', { name: /Runs|Insights|Agent team|Inbox|Workflow|Settings/ })).toHaveCount(0)
  await shot(page, 'po-ticket')

  // Product B, same Workspace: every door answers 404, and the factory's API says nothing.
  for (const path of [`/tickets/${betaTicket}`, `/requests/${betaRequest}`]) expect((await page.goto(path))?.status(), path).toBe(404)
  expect((await call(page, `/api/tickets/${alphaTicket}/artifacts/${alphaArtifact}`)).status).toBe(200)
  expect((await call(page, `/api/tickets/${betaTicket}/artifacts/${betaArtifact}`)).status).toBe(404)
  expect((await call(page, `/api/chat/context?path=/tickets/${betaTicket}`)).body?.label).toBe('Not found')
  expect((await call(page, `/api/chat/context?path=/tickets/${alphaTicket}`)).body?.label).toContain('Lab Alpha ticket')

  // The same Ticket for a Bauherr shows what the Product owner must not see (screenshot for comparison).
  await control.goto(`/tickets/${alphaTicket}`)
  await expect(control.getByRole('heading', { name: 'Steps', exact: true })).toBeVisible()
  await shot(control, 'bauherr-ticket')
})
