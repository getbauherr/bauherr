import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')
// The roles are the ones every pack has (orchestrator, engineer, reviewer): the e2e-fake job runs the 3-role gated pack. The orchestrator has a session, so it is never the default role. Read-only: the test that saves a role lives in workflow-editor.spec.ts (both write the Workspace's factory file, so they share one worker). Seeded in scripts/seed-e2e.ts: an orchestrator session working on #128, an idle reviewer, a disconnected engineer.

const signIn = async (page: Page, who = email) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const keyed = 'team-key@example.com'
const connect = (page: Page) => page.getByTestId('connect-panel')
const role = (page: Page) => connect(page).getByLabel('Role')

test('Agent team is in the sidebar after Workflow, not in Settings; /team lists summary, Connect, Sessions, Roles in that order', async ({ page }) => {
  await signIn(page)
  const links = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').allInnerTexts()
  const at = (name: string) => links.findIndex((l) => l.startsWith(name))
  expect(at('Agent team')).toBe(at('Workflow') + 1)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Agent team/ }).click()
  await expect(page.getByRole('heading', { name: 'Agent team', level: 1 })).toBeVisible()
  await expect(page.getByTestId('team-summary')).toHaveText(/^1 working · 1 idle( · \d+ roles? needs? an agent)?$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Connect a session', 'Sessions', 'Roles'])
  await expect(page.getByRole('radiogroup', { name: 'Roles' })).toHaveCount(0)
  await expect(page.getByText('No session connected', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('connect')).toHaveCount(0)
  await expect(page.locator('main button[data-variant=default]')).toHaveCount(1) // Copy prompt is the one accent button
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toHaveAttribute('data-variant', 'default')
})

test('the role defaults to the one with waiting work and no agent, and the hint says so', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team')
  const first = page.getByTestId('needs-agent-row').first()
  await expect(first).toContainText(/\d+ tickets? waiting/)
  await expect(role(page)).toHaveValue((await first.getAttribute('data-role'))!)
  await expect(page.getByTestId('connect-hint')).toHaveText(/^Default: \d+ tickets? waiting, no agent$/)
  await expect(page.locator('details', { hasText: 'First-time setup' })).not.toHaveAttribute('open', '') // a key and a session exist
})

test('one click on Copy prompt copies the prompt for the chosen role and the choice is remembered', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    if (navigator.clipboard) return // a secure context (localhost) has the real one; a dev server reached by another host name gets a stand-in
    let text = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (text = t), readText: async () => text } })
  })
  await signIn(page, keyed)
  await page.goto('/team')
  const prompt = /^Connect to the factory as (\w+)( with session "[a-z0-9-]+")? and work until I tell you to stop\.$/
  await expect(page.getByTestId('connect-prompt')).toHaveText(prompt)
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.getByTestId('connect-prompt').innerText())
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeVisible({ timeout: 3000 }) // "Copied" lasts 1.5 s
  await role(page).selectOption('orchestrator')
  await expect(page.getByTestId('connect-prompt')).toContainText('as orchestrator')
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('as orchestrator')
  expect(await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('bauherr-team-role:')).map(([, v]) => v))).toEqual(['orchestrator'])
})

test('without an agent key Copy prompt is disabled, says why and First-time setup is open', async ({ page }) => {
  await signIn(page, 'member@example.com') // the keyless user: the Admin gets a key from the setup and settings specs
  await page.goto('/team')
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeDisabled()
  await expect(connect(page).getByText('Create an agent key first.')).toBeVisible()
  await expect(page.locator('details', { hasText: 'First-time setup' })).toHaveAttribute('open', '')
  await expect(connect(page).getByRole('link', { name: 'Create an agent key' })).toHaveAttribute('href', '/settings/api-key')
})

test('/team?role= preselects the role; Connect on a needs-an-agent row selects it and focuses the select', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team?role=reviewer')
  await expect(role(page)).toHaveValue('reviewer')
  await expect(page.getByTestId('connect-prompt')).toContainText('as reviewer')
  await page.goto('/team')
  await page.getByTestId('needs-agent-row').first().getByRole('button', { name: 'Connect' }).click()
  await expect(role(page)).toBeFocused()
  await expect(role(page)).toHaveValue((await page.getByTestId('needs-agent-row').first().getAttribute('data-role'))!)
})

test('the role, the disclosure and the toggle survive a refresh', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team')
  await expect(async () => {
    await role(page).selectOption('orchestrator')
    await expect(role(page)).toHaveValue('orchestrator', { timeout: 1000 })
  }).toPass()
  await page.locator('summary', { hasText: 'First-time setup' }).click()
  await page.getByRole('switch').check()
  const refreshed = page.waitForResponse((r) => r.request().headers().rsc === '1')
  await page.evaluate(() => (window as unknown as { next: { router: { refresh: () => void } } }).next.router.refresh()) // what the 5 s poll does when something changed
  await refreshed
  await expect(role(page)).toHaveValue('orchestrator')
  await expect(page.locator('details', { hasText: 'First-time setup' })).toHaveAttribute('open', '')
  await expect(page.getByRole('switch')).toBeChecked()
})

test('session rows say who is working on which ticket, who is idle; the disconnected one is behind "Show 1 disconnected"', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  const row = (id: string) => page.locator(`#${id}`)
  await expect(row('ses_e2e_working')).toContainText('orchestrator-1@laptop')
  await expect(row('ses_e2e_working')).toContainText('Triaging')
  await expect(row('ses_e2e_working').getByRole('link', { name: /#128 Team: triage in a session/ })).toHaveAttribute('href', '/tickets/n/128')
  await expect(row('ses_e2e_idle')).toContainText('Idle')
  await expect(row('ses_e2e_idle')).toContainText('reviewer-1@laptop')
  await expect(row('ses_e2e_idle')).toContainText('No ticket')
  const rows = await page.getByTestId('sessions-list').locator('[data-testid=session-row]').evaluateAll((els) => els.map((e) => e.id))
  expect(rows.indexOf('ses_e2e_working')).toBeLessThan(rows.indexOf('ses_e2e_idle')) // working before idle
  await expect(row('ses_e2e_offline')).toHaveCount(0)
  await page.getByLabel('Show 1 disconnected').check()
  await expect(row('ses_e2e_offline')).toContainText('Disconnected')
  await expect(row('ses_e2e_offline')).toContainText(/\d+ min ago/)
  await expect(page.getByLabel('Hide disconnected')).toBeChecked()
})

test('sessions show their cost today, every Bauherr sees it', async ({ page }) => {
  await signIn(page)
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working').getByTestId('session-cost')).toHaveText('$0.400')
  await page.context().clearCookies()
  await signIn(page, 'member@example.com')
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working').getByTestId('session-cost')).toHaveText('$0.400')
})

test('the Workflow graph shows the agents stationed at a stage', async ({ page }) => {
  await signIn(page)
  await page.goto('/')
  await expect(page.locator('[data-testid=stage-node][data-stage=triage] [data-testid=stage-agent]')).toContainText('1 working')
  await expect(page.locator('[data-testid=stage-node][data-stage=review] [data-testid=stage-agent]')).toContainText('1 idle')
})

test('Insights lists the sessions with their active time', async ({ page }) => {
  await signIn(page)
  await page.goto('/insights')
  await expect(page.getByRole('heading', { name: 'Team', level: 2 })).toBeVisible()
  await expect(page.getByTestId('team-sessions')).toContainText('orchestrator-1@laptop')
})

test('a member sees the Agent team page but cannot change a role', async ({ page }) => {
  await signIn(page, 'member@example.com')
  await page.goto('/team')
  await expect(page.getByRole('heading', { name: 'Agent team', level: 1 })).toBeVisible()
  await page.locator('[data-testid=role-details][data-role=engineer] summary').click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(page.locator('[data-testid=role-details][data-role=engineer]').getByText('Only the owner can change a role.')).toBeVisible()
})

test('the header pill and the sidebar dot show who is working on every page; Settings does not list the Agent team', async ({ page }) => {
  await signIn(page)
  for (const path of ['/', '/inbox']) {
    await page.goto(path)
    await expect(page.getByTestId('presence-pill')).toHaveText(/^[1-9]\d* working · 1 idle$/)
    await expect(page.getByTestId('presence-dot')).toHaveAttribute('aria-label', /^[1-9]\d* working, 1 idle$/)
  }
  await page.getByTestId('presence-pill').click()
  await expect(page).toHaveURL(/\/team$/)
  await expect(page.getByRole('heading', { name: 'Agent team', level: 1 })).toBeVisible()
  await page.goto('/settings/profile')
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Team' })).toHaveCount(0)
})

const lineCount = (el: Element) => {
  const boxes = [...el.children].map((c) => c.getBoundingClientRect()).sort((a, b) => a.top - b.top)
  let lines = 0
  let bottom = -Infinity
  for (const b of boxes) {
    if (b.top >= bottom - 1) lines++
    bottom = lines && b.top >= bottom - 1 ? b.bottom : Math.max(bottom, b.bottom)
  }
  return lines
}

const phones = [375, 640]
for (const width of phones) {
  test(`no horizontal page scroll at ${width}px on /team and the agent page; Copy prompt is full width and 36px high`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await signIn(page, 'member@example.com') // keyless: First-time setup is open, the widest content
    for (const url of ['/team', '/team/ses_e2e_working']) {
      await page.goto(url)
      await page.locator('h1').first().waitFor()
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      expect(scroll, url).toBeLessThanOrEqual(client)
    }
    await page.goto('/team')
    const copy = await page.getByRole('button', { name: 'Copy prompt' }).boundingBox()
    const panel = await connect(page).boundingBox()
    expect(copy!.height).toBe(36)
    expect(copy!.width).toBeGreaterThanOrEqual(panel!.width - 2 * 25) // p-6 and the 1px border are the only gap
  })
}

test('on a phone the session rows wrap and the agent page stacks its panels in one column, Runs rows on two lines', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await signIn(page)
  await page.goto('/team')
  const row = page.locator('#ses_e2e_working')
  const lines = await row.evaluate(lineCount)
  expect(lines).toBeGreaterThanOrEqual(2)
  expect(lines).toBeLessThanOrEqual(3)
  await page.goto('/team/ses_e2e_working')
  const panels = ['Current Run', 'Cost', 'Milestones', 'Runs'].map((name) => page.getByRole('region', { name, exact: true }))
  const boxes = await Promise.all(panels.map((p) => p.boundingBox()))
  boxes.forEach((b, i) => {
    expect(b!.x, `panel ${i} left`).toBe(boxes[0]!.x)
    expect(b!.width, `panel ${i} width`).toBe(boxes[0]!.width)
    if (i) expect(b!.y, `panel ${i} below the previous`).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height)
  })
  const details = await page.getByTestId('agent-details').boundingBox()
  expect(details!.y).toBeGreaterThanOrEqual(boxes[3]!.y + boxes[3]!.height)
  const run = page.getByTestId('agent-run').first()
  await expect(run).toBeVisible()
  expect(await run.evaluate(lineCount)).toBe(2)
})

test('prefers-reduced-motion stops the spinner and the avatar loops', async ({ page }) => {
  await signIn(page)
  const running = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=session-row] *')].filter((e) => getComputedStyle(e).animationName !== 'none').length)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working')).toBeVisible()
  expect(await running(), 'a working row animates when motion is allowed').toBeGreaterThan(0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/team')
  await expect(page.locator('#ses_e2e_working')).toBeVisible()
  expect(await running()).toBe(0)
  await page.goto('/team/ses_e2e_working')
  await expect(page.getByTestId('agent-name')).toBeVisible()
  expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => getComputedStyle(e).animationName !== 'none').length)).toBe(0)
})

test('Tab reaches role select, Copy prompt, setup disclosure, toggle, Connect and row links in visual order', async ({ page }) => {
  await signIn(page, keyed)
  await page.goto('/team')
  await role(page).focus()
  const stops: string[] = ['Role']
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    stops.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement
      return (el.getAttribute('aria-label') ?? el.labels?.[0]?.textContent ?? el.textContent ?? '').trim()
    }))
  }
  const at = (re: RegExp) => stops.findIndex((s) => re.test(s))
  const order = [/^Role$/, /^Copy prompt$/, /^First-time setup$/, /^Show 1 disconnected$/, /^Connect$/, /^orchestrator-1@laptop/].map(at)
  expect(order, stops.join(' | ')).not.toContain(-1)
  expect(order, stops.join(' | ')).toEqual([...order].sort((a, b) => a - b))
})

test('Back from an agent page returns to /team with "Show disconnected" on and the scroll position', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 400 })
  await signIn(page)
  await page.goto('/team')
  await page.getByLabel('Show 1 disconnected').check()
  const link = page.getByRole('link', { name: 'orchestrator-1@laptop' })
  await link.scrollIntoViewIfNeeded()
  await page.evaluate(() => scrollBy(0, 150))
  const y = await page.evaluate(() => scrollY)
  expect(y).toBeGreaterThan(0)
  await link.click()
  await expect(page).toHaveURL(/\/team\/ses_e2e_working$/)
  await page.getByRole('link', { name: 'Agent team', exact: true }).first().click()
  await expect(page).toHaveURL(/\/team$/)
  await expect(page.getByLabel('Hide disconnected')).toBeChecked()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(20)
})
