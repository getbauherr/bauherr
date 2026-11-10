import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
test.skip(!process.env.E2E_FAKE_FORGE, 'needs the dev server started with BAUHERR_E2E_FAKE_FORGE=1 (set E2E_FAKE_FORGE=1 here)')

const shots = process.env.SHOTS_DIR

const login = async (page: Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()
}

// [slug, Ticket title, primary verb].
const STATES = [
  ['answer-decisions', 'Add a dark theme to the dashboard', 'Answer 2 questions'],
  ['answer-questions', 'Clarify the export scope', 'Answer 1 question'],
  ['approve-plan', 'Tidy the settings copy', 'Approve plan'],
  ['accept-staging', 'Ship the export header', 'Accept on staging'],
  ['approve-production', 'Ship the gated header', 'Approve production'],
  ['round-cap', 'Harden the retry loop', 'Grant one more round'],
  ['run-failed', 'Fix the date parser', 'Re-run build'],
  ['none', 'Export invoices as CSV', 'Queued'],
] as const

test('the action bar is the same single, visible bar in every state', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await login(page)
  let y: number | null = null
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const [slug, title, verb] of STATES) {
      await page.goto('/')
      await page.locator('.card', { hasText: title }).first().getByRole('link', { name: title }).click()
      const bar = page.getByTestId('action-bar')
      await expect(bar).toBeVisible()
      await expect(page.getByTestId('action-bar')).toHaveCount(1)
      await expect(bar.locator('[data-slot=button][data-variant=default]')).toHaveCount(1)
      await expect(bar.locator('[data-slot=button][data-variant=default]')).toHaveText(verb)
      await expect(bar.locator('[data-slot=button]')).not.toHaveCount(3)
      await page.evaluate(() => window.scrollTo(0, 0)) // the card click may leave the Board scroll offset behind
      const box = (await bar.boundingBox())!
      if (viewport.width > 640) {
        y ??= box.y
        expect(box.y).toBe(y)
      } else {
        expect(Math.round(box.y + box.height)).toBe(viewport.height)
      }
      if (shots) {
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme })
          await page.screenshot({ path: `${shots}/action-bar-${slug}-${scheme}-${viewport.width}x${viewport.height}.png` })
        }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 })
})

// Own seeded Ticket (#24): approving its plan changes nothing the other tests or specs read.
test('answer the critical decision, then approve the plan', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('[data-testid=workflow]')).toBeVisible()

  const row = page.locator('.card', { hasText: 'Add a light theme to the dashboard' }).first()
  await expect(row.getByText('Answer decisions')).toBeVisible()
  await row.getByRole('link', { name: 'Add a light theme to the dashboard' }).click()

  await expect(page.locator('#worklog')).toBeHidden()
  await page.getByText('Details', { exact: true }).click()
  await expect(page.locator('#worklog')).toBeVisible()
  await expect(page.locator('.sheet')).toHaveCount(0)
  const gaps = await page.locator('.max-w-\\[80ch\\] > p + *').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).marginTop)))
  expect(gaps.length).toBeGreaterThan(0)
  expect(gaps.every((g) => g > 0)).toBe(true)
  const bar = page.getByTestId('action-bar')
  const approve = bar.getByRole('button', { name: 'Approve plan' })
  await expect(bar.getByRole('link', { name: 'Answer 2 questions' })).toBeVisible()
  await expect(approve).toHaveCount(0)

  const chat = page.getByRole('region', { name: 'Answer questions' })
  await expect(chat).toContainText('Follow the system setting')
  await chat.getByRole('button', { name: 'yes, until the user picks' }).click()
  await expect(approve).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('#worklog')).toBeVisible()
  await expect(page.getByText('D2 Follow the system setting: yes, until the user picks')).toBeVisible()

  const actions: string[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.headers()['next-action']) actions.push(r.url()) })
  await approve.dblclick()
  await expect(page.getByText('Plan approved', { exact: true })).toBeVisible()
  expect(actions).toHaveLength(1)
  await expect(approve).toHaveCount(0)
})

test('an approval Ticket shows the bar, title, pipeline and the gate; the rest sits in a closed Details', async ({ page }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Tidy the settings copy' }).first().getByRole('link', { name: 'Tidy the settings copy' }).click()
  const details = page.locator('details')
  await expect(details).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('action-bar')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tidy the settings copy')
  await expect(page.getByTestId('ticket-path')).toBeVisible()
  await expect(page.getByText('Approves', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Approve plan' })).toHaveCount(0)
  for (const name of ['Budget', 'Model', 'Worklog']) await expect(page.getByText(name, { exact: true })).toBeHidden()
  await page.getByTestId('action-bar').getByRole('link', { name: 'Show details' }).click()
  await expect(details).toHaveAttribute('open', '')
  await expect(details.getByText('Budget', { exact: true })).toBeVisible()
  await expect(details.getByText('Model', { exact: true })).toBeVisible()
  await expect(details.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await expect(details.locator('table thead th')).toHaveText(['Run', 'Stage', 'Status', 'Duration', 'Evidence'])
  if (shots) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.screenshot({ path: `${shots}/details-open-${scheme}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png` })
    }
  }
})

test('Details shows Budget, Model and Run ids to an Admin only', async ({ page }) => {
  for (const [who, admin] of [['member@example.com', false], [email, true]] as const) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(who)
    await page.getByLabel('Password').fill(password())
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('[data-testid=workflow]')).toBeVisible()
    await page.locator('.card', { hasText: 'Tidy the settings copy' }).first().getByRole('link', { name: 'Tidy the settings copy' }).click()
    await page.getByText('Details', { exact: true }).click()
    const details = page.locator('details')
    for (const name of ['Budget', 'Model']) await expect(details.getByText(name, { exact: true })).toHaveCount(admin ? 1 : 0)
    if (!admin) await expect(details).not.toContainText(/\$|tokens|\/ 30 days|claude|gpt|sonnet|opus|haiku|Merge commit|#\d+\s*$/i)
    await expect(details.locator('table thead th')).toHaveText(admin ? ['Run', 'Stage', 'Status', 'Duration', 'Evidence'] : ['Stage', 'Status', 'When', 'Evidence'])
    await page.context().clearCookies()
  }
})

// Own seeded Tickets #25-#27: read-only, so no other spec's data is touched.
const nextStepOf = async (page: Page, title: string) => {
  await login(page)
  await page.locator('.card', { hasText: title }).first().getByRole('link', { name: title }).click()
  const bar = page.getByTestId('action-bar')
  const step = bar.locator('[data-slot=button][data-variant=default]')
  await expect(step).toHaveCount(1)
  return { bar, step }
}
const reasonOf = async (page: Page, step: ReturnType<Page['locator']>) => page.locator(`[id="${await step.getAttribute('aria-describedby')}"]`)

test('an approved plan held by an overlap shows a disabled button with the overlap reason and no decision box', async ({ page }) => {
  const { bar, step } = await nextStepOf(page, 'Hold the approved export tweak')
  const reason = 'Queued for Build: waits for #356, which changes the same files. Starts by itself.'
  await expect(step).toBeDisabled()
  await expect(bar.getByTitle(reason)).toHaveCount(1)
  await expect(await reasonOf(page, step)).toHaveText(reason)
  await expect(bar).not.toContainText('Nothing to do')
  await expect(page.getByRole('region', { name: 'Answer questions' })).toHaveCount(0)
  await page.getByText('Details', { exact: true }).click()
  await expect(page.locator('details')).toContainText('0 answered')
})

test('a plan waiting for approval shows an enabled Approve plan button', async ({ page }) => {
  const { step } = await nextStepOf(page, 'Approve the retry policy')
  await expect(step).toHaveText('Approve plan')
  await expect(step).toBeEnabled()
})

test('a Ticket with a live Run shows a disabled button naming the Run', async ({ page }) => {
  const { bar, step } = await nextStepOf(page, 'Review the retry policy')
  await expect(step).toBeDisabled()
  await expect(bar.getByTitle(/^The factory is working on this \(Run \d+\)\.$/)).toHaveCount(1)
  await expect(await reasonOf(page, step)).toHaveText(/\(Run \d+\)/)
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

test('a comment with a pasted, dropped and picked image is posted and the image link serves without login', async ({ page, playwright }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Export invoices as CSV' }).first().getByRole('link', { name: 'Export invoices as CSV' }).click()
  const box = page.getByRole('textbox', { name: 'Comment' })
  const post = page.getByRole('button', { name: 'Post comment' })
  await expect(post).toBeDisabled()
  const send = (type: 'paste' | 'drop', name: string) =>
    box.evaluate((el, [type, name, b64]) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(b64!), (c) => c.charCodeAt(0))], name!, { type: 'image/png' }))
      el.dispatchEvent(type === 'paste' ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, [type, name, PNG])
  await box.fill('The total is off')
  await send('paste', 'pasted.png')
  await expect(page.getByRole('list', { name: 'Images to post' }).getByText('pasted.png')).toBeVisible()
  await send('drop', 'dropped.png')
  await expect(page.getByText('dropped.png')).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add image' }).click()
  await (await chooser).setFiles({ name: 'picked.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') })
  await expect(page.getByText('picked.png')).toBeVisible()
  await page.getByRole('button', { name: 'Remove picked.png' }).click()
  await expect(page.getByText('picked.png')).toHaveCount(0)
  if (shots) {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.locator('#comment').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${shots}/comment-composer-1280x800.png` })
  }

  await post.click()
  const status = page.getByRole('status').filter({ hasText: 'Posted to the forge' })
  await expect(status).toBeVisible()
  await expect(box).toHaveValue('')
  const images = status.getByRole('img')
  await expect(images).toHaveCount(2)
  const src = (await images.first().getAttribute('src'))!
  expect(src).toMatch(/\/m\/\d+\/[\w-]+\.png$/)
  await expect.poll(() => images.first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  const anon = await playwright.request.newContext({ baseURL: process.env.BASE_URL })
  const res = await anon.get(src)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('image/png')
  await anon.dispose()
  if (shots) for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp)
      await page.locator('#comment').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${shots}/comment-posted-${scheme}-${vp.width}x${vp.height}.png` })
    }
  }
})

test('the path highlights the stages a Ticket visited and the steps name who ran them', async ({ page }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Export invoices as CSV' }).first().getByRole('link', { name: 'Export invoices as CSV' }).click()
  const path = page.getByTestId('ticket-path')
  const node = (stage: string) => path.getByTestId('path-node').filter({ hasText: new RegExp(`^${stage}`) })
  for (const stage of ['triage', 'plan', 'build']) await expect(node(stage)).toHaveAttribute('data-visited', 'true')
  await expect(node('review')).not.toHaveAttribute('data-visited', 'true')
  await expect(node('build')).toHaveAttribute('data-current', 'true')
  await expect(path.locator('[data-edge="plan>build"] path').first()).toHaveClass(/stroke-primary/)
  await expect(path.locator('[data-edge="build>review"] path').first()).not.toHaveClass(/stroke-primary/)
  const steps = page.getByTestId('ticket-steps')
  const build = steps.locator('[data-testid=visit][data-stage=build]')
  await expect(build.getByTestId('step-run')).toContainText('Session')
  await expect(build.getByTestId('step-run')).toContainText('e2e-laptop')
  await expect(build.getByTestId('step-run')).toContainText('claude-code 2.1.0')
  await expect(build.getByTestId('step-run')).toContainText('claude-sonnet-4-5')
  await expect(build.getByTestId('step-run')).toContainText('anthropic')
  await expect(build.getByRole('link', { name: /^Run #\d+$/ })).toHaveAttribute('href', /\/runs\/\d+$/)
  await expect(steps.locator('[data-testid=visit][data-stage=plan]').getByTestId('step-decision')).toHaveText(/approve plan by .+@example\.com/)
  await expect(steps.getByTestId('total-lead-time')).not.toHaveText('0 s')
})

test('a Ticket that looped shows its rounds', async ({ page }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Upgrade the payment SDK' }).first().getByRole('link', { name: 'Upgrade the payment SDK' }).click()
  await expect(page.getByTestId('path-rounds')).toContainText(['build: 2 rounds', 'review: 2 rounds'])
  await expect(page.locator('[data-testid=visit][data-stage=build]')).toHaveCount(2)
})

// Own seeded Ticket (#2 on Acme Checks): failed release checks with no run link leave one details button in the bar.
test('a failed release with no run link offers one details button', async ({ page }) => {
  await login(page)
  await page.locator('.card', { hasText: 'Release the CSV checks' }).first().getByRole('link', { name: 'Release the CSV checks' }).click()
  const bar = page.getByTestId('action-bar')
  await expect(bar.locator('[data-slot=button]')).toHaveCount(1)
  await expect(bar.locator('[data-slot=button][data-variant=default]')).toHaveText('Release failed: see details')
  await expect(bar.locator('[data-slot=button][data-variant=default]')).toHaveAttribute('href', '#details')
})
