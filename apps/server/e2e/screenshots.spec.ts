import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { email as seeded } from './user'

/**
 * Regenerates the README and landing-page screenshots in `docs/assets/`, each in a light and a dark variant, on the seeded e2e data (`pnpm screenshots`, see CONTRIBUTING.md).
 * Every shot fails when a seeded e2e identifier is visible on the page.
 * Skipped unless `SCREENSHOTS=1`. Needs the server of the fake-forge job (`BAUHERR_E2E_FAKE_FORGE=1`, `CHAT_FAKE=1`, the gated pack) and `DATABASE_URL`
 * of the screenshot database: the setup gives the seeded rows the names of a small real product there, and nowhere else.
 */
test.skip(process.env.SCREENSHOTS !== '1', 'SCREENSHOTS=1 regenerates docs/assets')
test.skip(!seeded || !process.env.E2E_PASSWORD_FILE || !process.env.DATABASE_URL, 'set E2E_EMAIL, E2E_PASSWORD_FILE and DATABASE_URL')
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const email = 'maria@acme.dev'
const owner = 'jonas@acme.dev'
const seededIdentifiers = ['e2e@example.com', 'e2e-', 'ses_e2e', 'card-owner', 'draft-owner', '-w1@']
const out = resolve(process.cwd(), '../../docs/assets')
const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const products: [string, string][] = [['Acme Gated', 'Acme Mobile'], ['Acme Checks', 'Acme API'], ['Acme Merge', 'Acme Docs'], ['Acme Relist', 'Acme Admin'], ['Acme Reship', 'Acme Billing'], ['Acme Widget', 'Acme Website'], ['Acme Proof', 'Acme Portal']]
const titles: [string, string][] = [
  ['Blocker: migrate the invoice table', 'Migrate the invoice table to the new schema'], ['Blocked: add the invoice filter', 'Add a status filter to the invoice list'],
  ['Awaiting close', 'Update the privacy policy link'], ['Awaiting archive', 'Fix the typo on the pricing page'],
  ['Add a light theme to the dashboard', 'Add a keyboard shortcut for search'], ['Hold the approved export tweak', 'Show the export progress in the toolbar'],
  ['Chat: cache the export totals', 'Cache the export totals'], ['Chat: rename the export columns', 'Rename the export columns'],
  ['Live build in progress', 'Add two-factor sign-in'], ['Waiting for a Build slot', 'Send invoices by email'],
  ['Hotfix: checkout crash', 'Hotfix: checkout crashes without an address'], ['Hotfix: login loop', 'Hotfix: sign-in loops after a password reset'],
  ['Ship the proof export', 'Ship the invoice download'], ['Ship the gated export', 'Ship the offline mode'], ['Ship the gated header', 'Ship the new app icon'],
  ['Recover the stalled import', 'Recover the stalled import job'], ['Release the CSV checks', 'Release the rate limit headers'],
  ['Relist the export totals', 'Show the export totals on the admin start page'], ['Relist the invoice filter', 'Add a filter to the admin user list'], ['Relist the CSV header', 'Fix the CSV header in the admin export'], ['Relist the earlier release', 'Add audit logs to the admin area'],
  ['Reship the export totals', 'Round invoice totals to two decimals'], ['Reship the invoice filter', 'Show the tax rate on each invoice line'],
  ['Ship the CSV export', 'Ship the CSV export for invoices'], ['Ship the invoice filter', 'Ship the invoice status filter'], ['Ship the export header', 'Ship the export file header'],
  ...[
    'Rewrite the onboarding emails', 'Speed up the dashboard load', 'Add a CSV import for customers', 'Fix the broken link in the footer', 'Support dark mode in emails', 'Show the last sign-in time',
    'Paginate the audit log', 'Add a password strength meter', 'Cache the exchange rates', 'Translate the invoice PDF into French', 'Fix the overflow on small screens', 'Add a shortcut to duplicate an invoice',
    'Warn before leaving an unsaved form', 'Add a health check endpoint', 'Remove the unused feature flags', 'Fix the time zone in reports', 'Upgrade the date picker', 'Rename the Team page to People',
    'Add a changelog page', 'Show a spinner while exporting', 'Fix the double submit on checkout', 'Log failed sign-in attempts',
  ].map((t, i): [string, string] => [`Isolated chore ${101 + i}`, t]),
]

test.beforeAll(async () => {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  for (const [from, to] of products) await db.query('UPDATE products SET name = $2::text WHERE name = $1::text', [from, to])
  for (const [from, to] of titles) await db.query(`UPDATE tickets SET title = $2::text, decision = replace(decision::text, $1::text, $2::text)::jsonb, plan_tldr = replace(plan_tldr::text, $1::text, $2::text)::jsonb, staging_tldr = replace(staging_tldr::text, $1::text, $2::text)::jsonb WHERE title = $1::text`, [from, to])
  await db.query('UPDATE runs SET session_label = $2::text WHERE session_label = $1::text', ['e2e-laptop', 'marias-laptop'])
  for (const [table, column] of [['human_touches', 'actor'], ['ticket_events', 'actor']]) await db.query(`UPDATE ${table} SET ${column} = $2::text WHERE ${column} = $1::text`, [seeded, email])
  await db.query('UPDATE bauherren SET email = $2::text WHERE email = $1::text', [seeded, email])
  await db.query('UPDATE bauherren SET email = $2::text WHERE email = $1::text', ['card-owner@example.com', owner])
  await db.query('DELETE FROM chat_messages')
  await db.query('DELETE FROM chat_threads')
  const { rows } = await db.query('SELECT b.id AS owner, (SELECT id FROM workspaces WHERE slug = $2::text) AS workspace FROM bauherren b WHERE b.email = $1::text', [email, 'acme'])
  const asked = new Date(Date.now() - 2 * 60e3).toISOString()
  const thread = (await db.query(`INSERT INTO chat_threads (owner_id, workspace_id, title, context, last_message_at) VALUES ($1, $2, $3::text, $4::jsonb, now()) RETURNING id`, [rows[0].owner, rows[0].workspace, 'What is waiting for me?', { path: '/inbox', label: 'Inbox' }])).rows[0].id
  const status = { stages: [], needYou: [] }
  const answer = [
    '**22 decisions wait for you.** The biggest group is *Approve plan*: #19, #26, #28, #29, #37 and #40.',
    '- 5 changes wait for you to accept them on staging',
    '- 2 reviews hit the round cap (#15, #38): one more round, or stop',
    '- 1 release is ready for production approval',
    '',
    'Say "approve #40" and I will ask you to confirm it first.',
  ].join('\n')
  const messages = [
    { id: 'seed-user-1', role: 'user', content: [{ type: 'text', text: 'What is waiting for me?' }], metadata: { custom: {} }, createdAt: asked, attachments: [] },
    { id: 'seed-answer-1', role: 'assistant', status: { type: 'complete', reason: 'unknown' }, createdAt: asked, metadata: { steps: [], custom: { usage: { ms: 1840, model: 'claude-sonnet-5-5', costUsd: 0.0042, tokensIn: 2310, tokensOut: 118 }, answerId: 'seed-answer-1' }, unstable_data: [], unstable_state: null, unstable_annotations: [] },
      content: [{ type: 'tool-call', toolName: 'factory_status', toolCallId: 'seed-status-1', args: {}, argsText: '{}', artifact: { kind: 'read', summary: 'factory_status()' }, result: { ok: true, text: JSON.stringify(status) } }, { type: 'text', text: answer }] },
  ]
  for (const [i, m] of messages.entries()) await db.query(`INSERT INTO chat_messages (thread_id, workspace_id, message_id, parent_id, role, message, answer) VALUES ($1, $2, $3::text, $4::text, $5::text, $6::jsonb, $7::jsonb)`, [thread, rows[0].workspace, m.id, i ? messages[0]!.id : null, m.role, m, i ? { ms: 1840, model: 'claude-sonnet-5-5', costUsd: 0.0042, tokensIn: 2310, tokensOut: 118, toolCalls: [{ ok: true, kind: 'read', name: 'factory_status' }] } : null])
  await db.end()
})

const signIn = async (page: Page, theme: 'light' | 'dark', who = email) => {
  await page.addInitScript((t) => localStorage.setItem('bauherr-theme', t), theme)
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}
const shoot = async (page: Page, name: string) => {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}*{caret-color:transparent!important}' })
  await page.waitForLoadState('networkidle')
  await page.mouse.move(1, 1)
  const visible = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll<HTMLInputElement>('input,textarea')].map((e) => e.value).join(' '))
  expect(seededIdentifiers.filter((id) => visible.includes(id)), `seeded identifiers visible on ${name}`).toEqual([])
  await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' })
}

const shots: [string, string, (page: Page) => Promise<void>][] = [
  ['workflow', email, async (page) => {
    await page.goto('/')
    await expect(page.getByTestId('workflow')).toBeVisible()
  }],
  ['workflow-editor', email, async (page) => {
    await page.goto('/workflow/edit')
    await expect(page.getByTestId('step').first()).toBeVisible()
  }],
  ['inbox', email, async (page) => {
    await page.goto('/inbox?checkpoint=Approve+plan')
    await expect(page.locator('article[data-decision]').first()).toBeVisible()
  }],
  ['ticket', email, async (page) => {
    await page.goto('/')
    await page.getByRole('link', { name: /Export invoices as CSV/ }).first().click()
    await expect(page).toHaveURL(/\/tickets\/\d+$/)
  }],
  ['insights', email, async (page) => {
    await page.goto('/insights')
    await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible()
  }],
  ['requests', owner, async (page) => {
    await page.goto('/requests')
    await expect(page.getByTestId('needs-row')).toContainText('Add an invoice filter')
  }],
  ['request-card', owner, async (page) => {
    await page.goto('/requests')
    await page.getByTestId('draft').getByRole('link', { name: 'Checkout is down' }).click()
    await expect(page.getByTestId('request-card').getByLabel('Title')).toHaveValue('Checkout is down')
  }],
  ['chat', email, async (page) => {
    await page.goto('/inbox')
    await page.getByTestId('chat-open').click()
    const dock = page.getByTestId('chat-dock')
    const input = dock.getByRole('textbox', { name: 'Message the factory' })
    await dock.getByTestId('thread-list-button').click()
    await page.getByTestId('thread-item').first().click()
    await expect(dock).toContainText('22 decisions wait for you', { timeout: 30_000 })
    await input.fill('approve #40')
    await input.press('Enter')
    await expect(dock.getByTestId('confirm-card')).toBeVisible({ timeout: 30_000 })
  }],
  ['templates', email, async (page) => {
    await page.goto('/settings/templates')
    await page.locator('table a').first().click()
  }],
  ['team', email, async (page) => {
    await page.goto('/team')
    await page.getByRole('radiogroup', { name: 'Roles' }).locator('[data-role=reviewer]').click()
    await expect(page.locator('#ses_e2e_working')).toContainText('Working')
    await expect(page.locator('#ses_e2e_idle')).toContainText('Idle')
    await page.addStyleTag({ content: '[data-testid=connect]{display:none!important}section[aria-labelledby=role-title]{min-height:0!important}section[aria-labelledby=sessions-engineer]{display:none!important}' }) // roster, role, a working and an idle session in one view
    await page.setViewportSize({ width: 1440, height: 1100 })
  }],
]

for (const [name, who, prepare] of shots) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${name} ${theme}`, async ({ page }) => {
      await signIn(page, theme, who)
      await prepare(page)
      await shoot(page, `screenshot-${name}${theme === 'dark' ? '-dark' : ''}`)
    })
  }
}
