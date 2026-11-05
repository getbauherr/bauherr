import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

test.skip(!email || !process.env.E2E_PASSWORD_FILE, 'set E2E_EMAIL and E2E_PASSWORD_FILE')

test('Board only, Runs on its own page, legacy view URLs redirect, Product filter', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const main = page.getByRole('navigation', { name: 'Main' })
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.board .col')).toHaveCount(6)
  await expect(page.locator('.col[data-stage=parent]')).toHaveCount(0)
  await expect(page.getByText('Split')).toHaveCount(0)
  await expect(page.locator('.col[data-stage=release] h2')).toContainText('Staging')
  await expect(page.getByRole('navigation', { name: 'View' })).toHaveCount(0)
  await expect(main.getByRole('link', { name: /^Tickets/ })).toHaveAttribute('aria-current', 'page')
  await expect(main.getByLabel(/need you/)).toBeVisible()
  // decision sheets are read from the forge; the production image has no fake forge
  if (process.env.E2E_FAKE_FORGE) await expect(page.locator('.col[data-stage=plan] .card').filter({ hasText: 'Answer decisions' }).first()).toBeVisible()

  // plan has no human gate by default (#175); the gated pack (E2E_GATED_PACK) turns it on, notification itself is covered in tests/gates.test.ts
  if (!process.env.E2E_GATED_PACK) await expect(page.locator('.col[data-stage=plan] .card [data-gate]')).toHaveCount(0)
  await expect(page.locator('.card .ticket-title', { hasText: 'Overhaul invoicing' })).toHaveCount(0)
  const tag = page.locator('.col[data-stage=build] .card').filter({ hasText: 'Invoice PDF layout' }).locator('.epic-tag')
  await expect(tag).toHaveText('Overhaul invoicing')
  await expect(tag).toHaveAttribute('href', /\/tickets\/\d+$/)
  await expect(page.locator('.col[data-stage=build] .card').filter({ hasText: 'Export invoices as CSV' }).locator('.epic-tag')).toHaveCount(0)
  // card budget (#258): title + status or needs-you verb + epic tag + Product, number and rank excluded; 3 text elements, 4 when it needs the owner
  const cardTexts = page.locator('.board .card')
  expect(await cardTexts.count()).toBeGreaterThan(5)
  for (const card of await cardTexts.all()) {
    const texts = await card.locator('> :not(.num):not(.rank)').count()
    expect(texts).toBeLessThanOrEqual(((await card.locator('[data-gate], .text-warn').count()) ? 4 : 3) + ((await card.locator('[data-hotfix]').count()) ? 1 : 0))
    const visible = (await card.evaluate((e) => {
      const c = e.cloneNode(true) as HTMLElement
      c.querySelectorAll('.rank').forEach((r) => r.remove())
      return c.textContent ?? ''
    }))
    expect(visible).not.toMatch(/run #\d+|@\w+|\bago\b|heartbeat|waiting \d/i)
  }
  await expect(page.locator('.card [data-slot=badge]').first()).toHaveAttribute('title', /.+/)
  await expect(page.locator('.card a[href^="http"]')).toHaveCount(0)
  const blocked = page.locator('.card').filter({ hasText: 'Blocked: add the invoice filter' }).first().locator('[data-status=blocked]')
  await expect(blocked).toHaveText('Blocked')
  await expect(blocked).toHaveAttribute('title', 'Blocked by #8')
  // Hotfix swimlane (#373): the lane's card is marked and first in its column, above every ranked card
  const buildCards = page.locator('.col[data-stage=build] .card')
  await expect(buildCards.first()).toHaveAttribute('data-lane', 'hotfix')
  await expect(buildCards.first().locator('[data-hotfix]')).toHaveText('Hotfix')
  await expect(buildCards.first()).toContainText('Hotfix: checkout crash')
  await expect(page.locator('.card [data-hotfix]')).toHaveCount(1)
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/board-epic-tag-${scheme}-${w}x${h}.png` })
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
  }

  const cards = page.locator('.card')
  const before = await cards.count()
  await page.getByLabel('Product').selectOption({ label: 'Acme Shop' })
  await expect(page).toHaveURL(/product=/)
  await expect.poll(() => cards.count()).toBeLessThan(before)

  const done = page.getByRole('link', { name: 'Show done' })
  await expect(done).toHaveAttribute('aria-pressed', 'false')
  await done.click()
  await expect(page).toHaveURL(/state=all/)
  await expect(page.getByRole('link', { name: 'Show done' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('link', { name: 'Show done' }).click()
  await expect(page).not.toHaveURL(/state=all/)

  await page.goto('/?view=list&state=all')
  await expect(page).toHaveURL(/\/\?state=all$/)
  await expect(page.locator('.board')).toBeVisible()

  await page.goto('/?view=runs&product=999999')
  await expect(page).toHaveURL(/\/runs\?product=999999$/)
  await page.goto('/?view=runs')
  await expect(page).toHaveURL(/\/runs$/)
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await expect(page.locator('table thead th')).toHaveText(['Ticket', 'Stage', 'Status', 'When'])
  await expect(page.locator('table tbody tr').first().locator('td').last()).toHaveText(/(ago|just now)$/)
  await expect(main.getByRole('link', { name: /^Tickets/ })).not.toHaveAttribute('aria-current', 'page')
  await page.getByLabel('Product').selectOption({ label: 'Acme Web' })
  await expect(page).toHaveURL(/\/runs\?product=/)
  // other specs start Runs on Acme Web Tickets, so assert the seeded Runs by Ticket instead of the row count
  for (const title of ['Tidy the settings copy', 'Fix the date parser', 'Add a dark theme to the dashboard', 'Export invoices as CSV', 'Live build in progress']) await expect(page.locator('table tbody tr').filter({ hasText: title }).first()).toBeVisible()
  await page.getByLabel('Product').selectOption({ label: 'Acme Shop' })
  await expect(page.locator('table tbody tr')).toHaveCount(2)
})

test('drag a Board card above another: the order survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const titles = () => page.locator('.col[data-stage=build] .card .ticket-title').allTextContents()
  const a = 'Blocker: migrate the invoice table'
  const b = 'Export invoices as CSV'
  await expect(page.locator('.col[data-stage=build] .card')).not.toHaveCount(0)
  const [first, second] = (await titles()).indexOf(a) < (await titles()).indexOf(b) ? [a, b] : [b, a]
  await page.locator('.col[data-stage=build] .card', { hasText: second }).dragTo(page.locator('.col[data-stage=build] .card', { hasText: first }))
  await expect.poll(async () => (await titles()).indexOf(second) < (await titles()).indexOf(first)).toBe(true)
  await expect(async () => {
    await page.reload()
    const after = await titles()
    expect(after.indexOf(second)).toBeLessThan(after.indexOf(first))
  }).toPass()
})

test('dragging a Board card shows the drop position', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()

  const col = page.locator('.col[data-stage=build]')
  const card = (name: string) => col.locator('.card[draggable=true]', { hasText: name })
  const marks = col.locator('[data-drop]')
  const titles = () => col.locator('.card .ticket-title').allTextContents()
  const a = 'Blocker: migrate the invoice table'
  const b = 'Export invoices as CSV'
  await expect(col.locator('.card')).not.toHaveCount(0)
  const start = await titles()
  const [upper, lower] = start.indexOf(a) < start.indexOf(b) ? [a, b] : [b, a]
  const centre = async (name: string) => {
    await card(name).scrollIntoViewIfNeeded()
    const box = (await card(name).boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const hover = async (name: string) => {
    const c = await centre(name)
    await page.mouse.move(c.x, c.y, { steps: 10 })
  }
  const grab = async (name: string) => {
    const c = await centre(name)
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
  }
  const above = async () => {
    const after = await titles()
    return after.indexOf(lower) < after.indexOf(upper)
  }
  const cancel = async () => {
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(marks).toHaveCount(0)
    expect(await above()).toBe(false)
  }

  await grab(lower)
  await hover(upper)
  await expect(marks).toHaveCount(1)
  await expect(card(upper)).toHaveAttribute('data-drop', 'before')
  const shots = process.env.SHOTS_DIR
  if (shots) {
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await hover(upper)
        await expect(marks).toHaveCount(1)
        await page.screenshot({ path: `${shots}/board-drop-line-${scheme}-${w}x${h}.png` })
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
    await hover(upper)
  }
  await hover(lower)
  await expect(marks).toHaveCount(0)
  await cancel()

  await grab(upper)
  await hover(lower)
  await expect(card(lower)).toHaveAttribute('data-drop', 'after')
  await cancel()

  await grab(lower)
  await hover(upper)
  await expect(card(upper)).toHaveAttribute('data-drop', 'before')
  await page.mouse.up()
  await expect(marks).toHaveCount(0)
  await expect.poll(above).toBe(true)
  await expect(async () => {
    await page.reload()
    expect(await above()).toBe(true)
  }).toPass()
})

test('hovering or dropping on a closed card in a mixed column shows no drop position and keeps the order', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.col[data-stage=build] .card').first()).toBeVisible()
  await page.goto('/?state=all')

  const col = page.locator('.col[data-stage=done]')
  const open = col.locator('.card[draggable=true]')
  const closed = col.locator('.card:not([draggable=true])')
  const marks = col.locator('[data-drop]')
  const titles = () => col.locator('.card .ticket-title').allTextContents()
  await expect(closed.filter({ hasText: /Invoice numbering|Signup analytics|Remove importer cron/ })).toHaveCount(3) // the seeded closed Tickets; release.spec accepts more
  await expect(col.locator('.card .ticket-title', { hasText: 'Retire the legacy importer' })).toHaveCount(0)
  const before = await titles()
  const at = async (l: typeof open) => {
    await l.scrollIntoViewIfNeeded()
    const box = (await l.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
  }
  await at(open.nth(1))
  await page.mouse.down()
  await at(open.first())
  await expect(marks).toHaveCount(1)
  await at(closed.first())
  await expect(marks).toHaveCount(0)
  await page.mouse.up()
  await expect(marks).toHaveCount(0)
  expect(await titles()).toEqual(before)
})

test('A running Run marks its card and names the activity', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  const card = page.locator('.col[data-stage=build] .card[data-running]').filter({ hasText: 'Live build in progress' })
  await expect(card).toContainText('Working')
  await expect(card.locator('[data-status=working]')).toHaveText('Working')
  await expect(card.locator('[data-status=working]')).toHaveAttribute('title', /^building/)
  await expect(card.locator('[data-status=working]')).toHaveAttribute('title', /build Run #\d+ · scheduler/)
  await expect(card).not.toContainText(/scheduler|Run #/)
})

test('Epic filter narrows Board, Graph and Runs; Epics view lists open epics with progress; epic page shows sub-tickets', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.board')).toBeVisible()
  const shots = process.env.SHOTS_DIR
  const shoot = async (name: string) => {
    if (!shots) return
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h })
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.screenshot({ path: `${shots}/${name}-${scheme}-${w}x${h}.png` })
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
  }

  await page.getByRole('combobox', { name: 'Epic' }).selectOption({ label: '#11 Overhaul invoicing' })
  await expect(page).toHaveURL(/epic=/)
  await expect(page.locator('.card')).toHaveCount(1)
  await expect(page.locator('.card')).toContainText('Invoice PDF layout')
  await shoot('board-epic-filter')
  const epic = new URL(page.url()).searchParams.get('epic')!
  await page.goto(`/?view=graph&epic=${epic}`)
  await expect(page.locator('a.gnode')).toHaveCount(1)
  await page.goto(`/runs?epic=${epic}`)
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(0)

  await page.goto('/')
  await page.getByRole('navigation', { name: 'Tickets layout' }).getByRole('link', { name: 'Epics' }).click()
  await expect(page).toHaveURL(/view=epics/)
  const rows = page.locator('.epics > li')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Overhaul invoicing' })).toContainText('1/2 done')
  await expect(rows.filter({ hasText: 'Revamp onboarding' })).toContainText('1/3 done')
  await expect(rows.filter({ hasText: 'Revamp onboarding' })).toContainText('plan 1 · build 1')
  await expect(page.getByRole('combobox', { name: 'Epic' })).toHaveCount(0)
  await rows.filter({ hasText: 'Revamp onboarding' }).locator('summary').click()
  await expect(rows.filter({ hasText: 'Revamp onboarding' }).getByRole('link', { name: 'Signup form validation' })).toBeVisible()
  await rows.filter({ hasText: 'Overhaul invoicing' }).locator('summary').click()
  await shoot('epics-view')
  await page.getByRole('link', { name: 'Show done' }).click()
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: 'Retire the legacy importer' })).toContainText('1/1 done')

  await rows.filter({ hasText: 'Overhaul invoicing' }).getByRole('link', { name: 'Open epic' }).click()
  await expect(page.getByRole('heading', { name: 'Sub-tickets' })).toBeVisible()
  await expect(page.locator('.echildren li')).toHaveCount(2)
  await expect(page.locator('.eprog')).toContainText('1/2 done')
  await expect(page.locator('ol[aria-label=Stage]')).toHaveCount(0)
  await shoot('epic-page')

  await page.goto('/?view=epics&done=1')
  await shoot('epics-view-show-done')
  await rows.filter({ hasText: 'Retire the legacy importer' }).locator('summary').click()
  await rows.filter({ hasText: 'Retire the legacy importer' }).getByRole('link', { name: 'Open epic' }).click()
  await expect(page.getByRole('heading', { name: 'Sub-tickets' })).toBeVisible()
  await expect(page.locator('.echildren li')).toHaveCount(1)
  await expect(page.locator('ol[aria-label=Stage]')).toHaveCount(0)
  await shoot('epic-page-closed')
  await page.goto('/?epic=')
})

test('The epic filter is remembered per user; an explicit All clears it; the empty epic offers to clear it', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  const epic = page.getByRole('combobox', { name: 'Epic' })
  const main = page.getByRole('navigation', { name: 'Main' })
  await epic.selectOption({ label: '#11 Overhaul invoicing' })
  await expect(page).toHaveURL(/epic=/)
  await page.goto('/runs')
  await expect(page).toHaveURL(/epic=/)
  await main.getByRole('link', { name: /^Tickets/ }).click()
  await expect(page).toHaveURL(/epic=/)
  await expect(page.locator('.card')).toHaveCount(1)
  await expect(epic).not.toHaveValue('')
  await epic.selectOption({ label: 'All' })
  await expect(page).toHaveURL(/epic=$/)
  await page.goto('/runs')
  await page.goto('/')
  await expect(page).not.toHaveURL(/epic=\d/)
  await expect(page.locator('.card')).not.toHaveCount(1)
  await epic.selectOption({ label: '#35 Retire the legacy importer' })
  await expect(page.getByText('No open tickets in this epic.')).toBeVisible()
  await page.getByRole('link', { name: 'Clear the epic filter' }).click()
  await expect(page.locator('.card')).not.toHaveCount(0)
  await page.goto('/')
  await expect(page).not.toHaveURL(/epic=\d/)
})
