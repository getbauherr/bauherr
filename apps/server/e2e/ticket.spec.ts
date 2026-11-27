import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'
import { inboxRow, openFromInbox } from './inbox'

const password = () => readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim()

const relationsSection = (page: Page, title: string) =>
  page
    .locator('section:not([aria-label="Relations"])')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })

const STALE = 'The ticket moved while this was open. Reload to see where it is now.'

const signIn = async (page: Page) => {
  const url = process.env.BASE_URL ?? 'http://localhost:3000'
  await page.context().addCookies([{ name: 'bauherr-ws', value: 'tickets', url }])
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const open = async (page: Page, title: string) => {
  await openFromInbox(page, new RegExp(title))
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  return new URL(page.url()).pathname
}

const enter = async (page: Page, title: string) => {
  await signIn(page)
  return open(page, title)
}

const enterOpen = async (page: Page, base: string) => {
  await signIn(page)
  await openFromInbox(page, new RegExp(`${base} \\d`))
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`^${base} \\d$`) })).toBeVisible()
  return new URL(page.url()).pathname
}

test('approving a Brief stores the chosen option and the ticket moves on to Build', async ({ page }) => {
  await enterOpen(page, 'Brief with a decision to approve')
  await expect(page.getByText('This Brief has an open decision.')).toBeVisible()
  await page.getByRole('radio', { name: /Disk/ }).check()
  await page.getByRole('button', { name: 'Approve Brief' }).click()
  await expect(page.getByRole('button', { name: 'Approve Brief' })).toHaveCount(0)
  const path = page.getByRole('navigation', { name: 'Stage path' })
  await expect(path.locator('[aria-current="step"]')).toContainText('Build')
  await page.goto(`${new URL(page.url()).pathname}?tab=brief`)
  await expect(page.getByText('Stream the file to disk or to object storage?')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Stream the file' })).toContainText('Disk by you')
})

test('a Brief card lists the relations the factory proposes, each with a remove cross', async ({ page }) => {
  await enterOpen(page, 'Brief with proposed relations')
  const proposed = relationsSection(page, 'Proposed relations')
  await expect(proposed.getByRole('listitem')).toHaveCount(2)
  await expect(proposed.getByRole('listitem').first()).toContainText('Blocked by')
  await expect(proposed.getByRole('listitem').first()).toContainText('(The export needs its storage first.)')
  await expect(proposed.getByRole('listitem').last()).toContainText('Part of')
  await expect(proposed.getByRole('button', { name: /^Remove:/ })).toHaveCount(2)
})

test('removing one proposed relation before approving keeps only the other', async ({ page }) => {
  await enterOpen(page, 'Brief with proposed relations')
  await page.getByRole('button', { name: /^Remove: Blocked by/ }).click()
  await expect(relationsSection(page, 'Proposed relations').getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Approve Brief' }).click()
  await expect(page.getByRole('button', { name: 'Approve Brief' })).toHaveCount(0)
  await page.goto(`${new URL(page.url()).pathname}?tab=brief`)
  const kept = relationsSection(page, 'Relations')
  await expect(kept.getByRole('listitem')).toHaveCount(1)
  await expect(kept).toContainText('Part of')
  await expect(kept).not.toContainText('Blocked by')
})

test('sending a Result back asks for a comment in the card field and records it', async ({ page }) => {
  const path = await enterOpen(page, 'Result to send back')
  await page.getByRole('button', { name: 'Send back with note' }).click()
  const alert = page.getByRole('main').getByRole('alert')
  await expect(alert).toHaveText('Say what should change, then press Send back with note again.')
  await expect(page.getByLabel('Comment')).toBeFocused()
  await page.getByLabel('Comment').fill('Add a test for the empty file.')
  await expect(page.getByLabel('Applies to')).toHaveCount(0)
  await page.getByRole('button', { name: 'Send back with note' }).click()
  await expect(page.getByLabel('Comment')).toHaveCount(0)
  await page.goto(`${path}?tab=activity`)
  await expect(page.getByText('The owner sent the Result back: Add a test for the empty file.')).toBeVisible()
})

test('accepting a Result ends the ticket', async ({ page }) => {
  await enterOpen(page, 'Result to accept')
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'The Result was accepted' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
})

test('answering a question from the agent records the chosen option', async ({ page }) => {
  const path = await enterOpen(page, 'Question from the agent')
  await expect(page.getByText('Which storage should the export use?')).toBeVisible()
  await page.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Choose an answer first.')
  await page.getByRole('radio', { name: 'Object storage' }).check()
  await page.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByRole('button', { name: 'Answer' })).toHaveCount(0)
  await page.goto(`${path}?tab=activity`)
  await expect(page.getByText('The owner answered: Object storage')).toBeVisible()
})

test('a parked ticket names its need in the Inbox and offers Resume and Discard', async ({ page }) => {
  await signIn(page)
  await page.goto('/inbox')
  await inboxRow(page, /Build parked on a missing Connection/).getByRole('button').click()
  const main = page.getByRole('main')
  await expect(main.getByText('Parked: AWS Connection')).toBeVisible()
  await expect(main.getByRole('button', { name: 'Resume' })).toBeVisible()
  await expect(main.getByRole('button', { name: 'Discard…' })).toBeVisible()
})

test('a decision on a card that moved on shows the stale sentence', async ({ page, browser }) => {
  const path = await enterOpen(page, 'Result decided twice')
  await page.route('**/api/changes*', (route) => route.abort())
  const other = await browser.newPage()
  await signIn(other)
  await other.goto(path)
  await other.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(other.getByRole('status').filter({ hasText: 'The Result was accepted' })).toBeVisible()
  await page.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(STALE)
  await other.close()
})

test('the tabs are addressable and the proof of a criterion opens from its row', async ({ page }) => {
  const path = await enter(page, 'Result to read')
  const tabs = page.getByRole('navigation', { name: 'Ticket tabs' })
  await expect(tabs.getByRole('link', { name: 'Now' })).toHaveAttribute('aria-current', 'page')
  await page.goto(`${path}?tab=brief`)
  await expect(tabs.getByRole('link', { name: 'Brief' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Exports over 50 MB finish instead of timing out.')).toBeVisible()
  await tabs.getByRole('link', { name: 'Result' }).click()
  await expect(page).toHaveURL(/\?tab=result$/)
  await expect(page.getByRole('heading', { name: 'What changed' })).toBeVisible()
  await tabs.getByRole('link', { name: 'Activity' }).click()
  await expect(page).toHaveURL(/\?tab=activity$/)
  await expect(page.getByText('A Brief was submitted')).toBeVisible()
  await page.goto(path)
  await page.getByRole('link', { name: /Screenshot/ }).click()
  await expect(page).toHaveURL(/\?proof=c2$/)
  await expect(page.getByRole('heading', { name: 'Proof for criterion 2' })).toBeVisible()
  await expect(page.getByRole('link', { name: /example\.com\/shots\/progress\.png/ })).toBeVisible()
})

test('an Intake ticket shows the check and the question sent to the reporter', async ({ page }) => {
  await enter(page, 'Intake waiting for the reporter')
  await expect(page.getByRole('heading', { name: 'Intake check' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Question sent to the reporter, round 1 of 2' })).toBeVisible()
  await expect(page.getByText('Which report shows the wrong year?')).toBeVisible()
  await expect(page.getByText('Waiting for the reporter. Nothing to do.')).toBeVisible()
})

test('an adopted pull request waiting on its author says so and lists the other pull requests', async ({ page }) => {
  await enter(page, 'Adopted pull request waiting on its author')
  await expect(page.getByText('Adopted pull request by dev-sam')).toBeVisible()
  await expect(page.getByText('Waiting on author', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Waiting on the author of the pull request.')).toBeVisible()
  const path = page.getByRole('navigation', { name: 'Stage path' })
  await expect(path).not.toContainText('Build')
  await expect(path.locator('[aria-current="step"]')).toContainText('Verify')
  const others = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Other pull requests' }) })
  await expect(others).toContainText('Another take on the fix')
  await expect(others).toContainText('dev-lee')
})

test('the Result card of an adopted pull request says that accepting merges it', async ({ page }) => {
  await enter(page, 'Adopted pull request with a result')
  await expect(page.getByText('Adopted pull request by dev-sam')).toBeVisible()
  await expect(page.getByText('Accept the Result to merge the pull request and finish the ticket.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
})

test('the run page lists the reported steps oldest first', async ({ page }) => {
  await enter(page, 'Build with reported steps')
  await page.getByRole('link', { name: /^Run \d+$/ }).click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  const steps = page.getByRole('list').filter({ hasText: 'Started from record version 3.' }).getByRole('listitem')
  await expect(steps).toHaveCount(4)
  await expect(steps.first()).toContainText('Started from record version 3.')
  await expect(steps.last()).toContainText('Plan step 3 of 4: screenshots of both report pages.')
  await expect(page.getByRole('heading', { name: 'Context given to the agent' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Cost so far/ })).toBeVisible()
})

test('the verify-rounds card shows what the verifier asks and what the builder did, and links to the handoff', async ({
  page,
}) => {
  await enter(page, 'Review rounds used up')
  const card = page.getByRole('main')
  await expect(card.getByRole('heading', { name: 'Where they differ after 2 review rounds' })).toBeVisible()
  await expect(card.getByRole('heading', { name: 'Verifier: last open finding' })).toBeVisible()
  await expect(card.getByText('A failed chunk is never retried').first()).toBeVisible()
  await expect(card.getByRole('heading', { name: 'Builder: last handoff' })).toBeVisible()
  await expect(card.getByText('I kept the chunked export')).toContainText('…')
  await expect(card.getByText('END', { exact: true })).toHaveCount(0)
  await card.getByRole('link', { name: 'Read the full handoff' }).click()
  await expect(page).toHaveURL(/\/runs\/\d+$/)
  await expect(page.getByText(/did not add the retry the verifier asks for\. END$/)).toBeVisible()
})

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`the verify-rounds card fits one screen at ${size.width} px`, async ({ page }) => {
    await page.setViewportSize(size)
    await enter(page, 'Review rounds used up')
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Answer' }) })
    await expect(form).toBeVisible()
    const bottom = await form.evaluate((el) => el.getBoundingClientRect().bottom)
    expect(bottom).toBeLessThanOrEqual(size.height)
  })
}

test('an agent question in Build can send the ticket back to Brief with a note', async ({ page }) => {
  const path = await enterOpen(page, 'Question to send back to Brief')
  const answer = page.getByRole('button', { name: 'Answer' })
  const back = page.getByRole('button', { name: 'Back to Brief' })
  await expect(back).toBeVisible()
  expect(await back.evaluate((node) => node.nextElementSibling?.textContent)).toBe('Answer')
  await back.click()
  await expect(page.getByLabel('Comment')).toBeFocused()
  await page.getByLabel('Comment').fill('Redo the Brief as a redesign with a mockup first.')
  await back.click()
  await expect(page.getByLabel('Comment')).toHaveCount(0)
  await expect(answer).toHaveCount(0)
  const stages = page.getByRole('navigation', { name: 'Stage path' })
  await expect(stages.locator('[aria-current="step"]')).toContainText('Brief')
  await page.goto(`${path}?tab=activity`)
  const note = 'Sent back to Brief: Redo the Brief as a redesign with a mockup first.'
  await expect(page.getByText(note)).toBeVisible()
})

test('archiving a ticket asks in a dialog and removes it from the Inbox, and Restore brings it back', async ({
  page,
}) => {
  const path = await enterOpen(page, 'Brief to archive')
  const title = await page.getByRole('heading', { level: 1 }).innerText()
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type())
    void dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('The issue is closed as not planned')
  await dialog.getByRole('button', { name: 'Archive ticket' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Archived. The ticket is out of the lists')).toBeVisible()
  expect(dialogs).toEqual([])
  await page.goto('/inbox')
  await expect(page.locator('[data-inbox-row]').filter({ hasText: title })).toHaveCount(0)
  await page.goto(path)
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()
  await page.goto('/inbox')
  await expect(inboxRow(page, title)).toBeVisible()
})

test('a free answer and an empty change request use the comment field', async ({ page }) => {
  const path = await enterOpen(page, 'Question to answer in own words')
  await expect(page.getByLabel('Comment')).toHaveCount(0)
  await page.getByRole('radio', { name: 'None of these, my answer:' }).check()
  await expect(page.getByLabel('Comment')).toBeFocused()
  await page.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Write your answer, then press Answer again.')
  await page.getByLabel('Comment').fill('Stream it to object storage in chunks.')
  await page.getByRole('button', { name: 'Answer' }).click()
  await expect(page.getByRole('button', { name: 'Answer' })).toHaveCount(0)
  await page.goto(`${path}?tab=activity`)
  const own = 'The owner answered in their own words: Stream it to object storage in chunks.'
  await expect(page.getByText(own)).toBeVisible()
  await openFromInbox(page, /Brief to comment on \d/)
  await page.getByRole('button', { name: 'Request changes' }).click()
  const missing = 'Say what should change, then press Request changes again.'
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(missing)
  await expect(page.getByLabel('Comment')).toBeFocused()
  await page.getByLabel('Comment').fill('Name the migration step.')
  await page.getByRole('button', { name: 'Request changes' }).click()
  await expect(page.getByLabel('Comment')).toHaveCount(0)
  await page.goto(`${new URL(page.url()).pathname}?tab=activity`)
  await expect(page.getByText('The owner asked for changes to the Brief: Name the migration step.')).toBeVisible()
})
