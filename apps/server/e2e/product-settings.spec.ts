import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { email } from './user'

const signIn = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(readFileSync(process.env.E2E_PASSWORD_FILE!, 'utf8').trim())
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('banner')).toBeVisible()
}

const inConnect = (page: Page) =>
  page
    .context()
    .addCookies([{ name: 'bauherr-ws', value: 'connect', url: process.env.BASE_URL ?? 'http://localhost:3000' }])

const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

const addProduct = async (page: Page, name: string) => {
  const repo = `e2e/p${Date.now()}`
  await page.goto('/settings/products/new')
  await page.getByLabel('Product name').fill(name)
  if (process.env.E2E_FAKE_FORGE) {
    await page.getByLabel('Repository', { exact: true }).selectOption({ label: 'Other...' })
    await page.getByLabel('Other repository').fill(repo)
  } else await page.getByLabel('Repository', { exact: true }).fill(repo)
  await page.getByRole('button', { name: 'Add Product' }).click()
  await expect(page).toHaveURL(/\/settings\/products\/\d+\/connect$/)
  return `/settings/products/${/products\/(\d+)/.exec(page.url())![1]}`
}

const confirmRemove = async (scope: Locator, label: string, done: (timeout: number) => Promise<void>) => {
  const confirm = scope.locator('button:visible', { hasText: 'Confirm remove' }).first()
  const holds = (timeout: number) =>
    done(timeout).then(
      () => true,
      () => false,
    )
  await expect(async () => {
    if (await holds(500)) return
    await scope
      .locator('details[data-slot=advanced]')
      .evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)))
    if (!(await confirm.isVisible()))
      await scope.locator('button', { hasText: label }).first().click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000, noWaitAfter: true })
    await done(8_000)
  }).toPass({ timeout: 40_000 })
}

const deleteProduct = async (page: Page, path: string) => {
  await page.goto(path)
  const repository = page.locator('#repository')
  await expect(repository).toBeVisible()
  for (const label of ['Stop reading tickets', 'Remove repository']) {
    await confirmRemove(repository, label, (t) =>
      expect(repository.locator('button', { hasText: label })).toHaveCount(0, { timeout: t }),
    )
  }
  await confirmRemove(page.locator('#danger'), 'Delete Product', (t) =>
    expect(page).toHaveURL(/\/settings\/products$/, { timeout: t }),
  )
}

const ownProduct = async (page: Page, run: (path: string) => Promise<void>) => {
  await signIn(page)
  const path = await addProduct(page, `E2E Settings ${Date.now()}`)
  try {
    await page.goto(path)
    await run(path)
  } finally {
    await deleteProduct(page, path)
  }
}

test('a new Product lands on the Connect page, opens its settings and is deleted again', async ({ page }) => {
  test.setTimeout(120_000)
  const name = `E2E Widgets ${Date.now()}`
  await signIn(page)
  await page.goto('/settings/products')
  await expect(page.getByRole('row', { name: /Acme Web/ })).toContainText('Off')
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  const path = await addProduct(page, name)
  await expect(page.getByRole('heading', { name: `Connect ${name}` })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(4)
  await expect(page.getByRole('list', { name: 'Steps' })).toContainText('One repository attached')
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await deleteProduct(page, path)
  await expect(page.getByRole('link', { name })).toHaveCount(0)
  expect((await page.goto('/settings/products/999999'))?.status()).toBe(404)
  expect((await page.goto('/settings/products/999999/connect'))?.status()).toBe(404)
})

test('Intake saves its own fields and says why a silence before the reminder is refused', async ({ page }) => {
  test.setTimeout(120_000)
  await ownProduct(page, async () => {
    const intake = page.locator('#intake')
    const labels = intake.getByRole('group', { name: 'Excluded labels' })
    await labels.getByRole('textbox', { name: 'Add an excluded label' }).fill('wontfix')
    await labels.getByRole('button', { name: 'Add' }).click()
    await intake.getByLabel('Outside issues per author and day').fill('8')
    await intake.getByLabel('Remind a reporter after (days)').fill('10')
    await intake.getByLabel('Count a reporter as silent after (days)').fill('3')
    await intake.getByRole('button', { name: 'Save intake' }).click()
    await expect(intake.getByText('Silence counts after the reminder: use more days.')).toBeVisible()
    await intake.getByLabel('Count a reporter as silent after (days)').fill('30')
    await intake.getByRole('switch', { name: /Close automatically/ }).uncheck()
    await intake.getByRole('button', { name: 'Save intake' }).click()
    await saved(page)
    await page.reload()
    await expect(intake.getByLabel('Outside issues per author and day')).toHaveValue('8')
    await expect(intake.getByLabel('Remind a reporter after (days)')).toHaveValue('10')
    await expect(intake.getByLabel('Count a reporter as silent after (days)')).toHaveValue('30')
    await expect(intake.getByRole('checkbox', { name: /wontfix/ })).toBeChecked()
    await expect(intake.getByRole('switch', { name: /Close automatically/ })).not.toBeChecked()
    await expect(intake).toContainText('2 rounds')
  })
})

test('Gates save path sets, risk areas, the production switch and the Brief limit', async ({ page }) => {
  test.setTimeout(120_000)
  await ownProduct(page, async () => {
    const gates = page.locator('#gates')
    await expect(gates.getByText('Add a path set first, then choose it here.')).toBeVisible()
    await gates.getByLabel('Path sets').fill('security: src/auth/**\nui: src/app/**')
    await gates.getByRole('button', { name: 'Save path sets' }).click()
    await saved(page)
    await page.reload()
    await gates.getByRole('checkbox', { name: /^security/ }).check()
    await gates.getByRole('switch', { name: /Ask me before production/ }).check()
    await gates.getByLabel('Briefs waiting on you at a time').fill('7')
    await gates.getByRole('button', { name: 'Save gates' }).click()
    await saved(page)
    await page.reload()
    await expect(gates.getByRole('checkbox', { name: /^security/ })).toBeChecked()
    await expect(gates.getByRole('checkbox', { name: /^ui/ })).not.toBeChecked()
    await expect(gates.getByRole('switch', { name: /Ask me before production/ })).toBeChecked()
    await expect(gates.getByLabel('Briefs waiting on you at a time')).toHaveValue('7')
    await expect(gates).toContainText('A Brief card goes to you when it has an open decision')
  })
})

test('Proof saves the required checks, the deploy checks, the deploy wait and the staging site', async ({ page }) => {
  test.setTimeout(120_000)
  await ownProduct(page, async () => {
    const proof = page.locator('#proof')
    const required = proof.getByRole('group', { name: 'Required checks' })
    await required.getByRole('textbox', { name: 'Add a check that has not run yet' }).fill('test')
    await required.getByRole('button', { name: 'Add' }).click()
    const deploy = proof.getByRole('group', { name: 'Deploy checks' })
    await deploy.getByRole('textbox', { name: 'Add a deploy check' }).fill('deploy-staging')
    await deploy.getByRole('button', { name: 'Add' }).click()
    const wait = proof.getByRole('spinbutton', { name: /Ask me when the deploy has not finished after/ })
    await wait.fill('45')
    await proof.getByRole('textbox', { name: 'Staging site' }).fill('https://staging.e2e.example.com')
    await proof.getByRole('button', { name: 'Save proof' }).click()
    await saved(page)
    await page.reload()
    await expect(required.getByRole('checkbox', { name: /test/ })).toBeChecked()
    await expect(deploy.getByRole('checkbox', { name: /deploy-staging/ })).toBeChecked()
    await expect(wait).toHaveValue('45')
    await expect(proof.getByRole('textbox', { name: 'Staging site' })).toHaveValue('https://staging.e2e.example.com')
  })
})

test('Repository saves who works the runs and says how the mirror stands', async ({ page }) => {
  test.setTimeout(120_000)
  await ownProduct(page, async () => {
    const repository = page.locator('#repository')
    await expect(repository.getByRole('radio', { name: /An agent session/ })).toBeChecked()
    await expect(repository.getByRole('link', { name: 'Connect a session' })).toHaveAttribute(
      'href',
      '/settings/api-key',
    )
    await repository.getByRole('radio', { name: /The Runner/ }).check()
    await repository.getByRole('button', { name: 'Save', exact: true }).click()
    await saved(page)
    await page.reload()
    await expect(repository.getByRole('radio', { name: /The Runner/ })).toBeChecked()
    await expect(repository.getByRole('link', { name: 'Connect a session' })).toHaveCount(0)
    await expect(repository).toContainText('Observing: nothing is written to the forge')
    await expect(repository.getByRole('link', { name: 'See the first look' })).toBeVisible()
  })
})

test('an unsaved Repository change says so, asks before leaving and says Saved afterwards', async ({ page }) => {
  test.setTimeout(120_000)
  await ownProduct(page, async (path) => {
    const repository = page.locator('#repository')
    const notSaved = page.getByText('Not saved yet')
    await expect(notSaved).toHaveCount(0)
    await repository.getByRole('radio', { name: /The Runner/ }).check()
    await expect(repository.getByText('Not saved yet')).toBeVisible()
    await expect(page.locator('#intake').getByText('Not saved yet')).toHaveCount(0)
    const nav = page.getByRole('navigation', { name: 'Settings' })
    await nav.getByRole('link', { name: 'Products' }).click()
    const dialog = page.getByRole('dialog', { name: 'Leave without saving?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Stay' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(repository.getByRole('radio', { name: /The Runner/ })).toBeChecked()
    await nav.getByRole('link', { name: 'Products' }).click()
    await dialog.getByRole('button', { name: 'Discard' }).click()
    await expect(page).toHaveURL(/\/settings\/products$/)
    await page.goto(path)
    await repository.getByRole('radio', { name: /The Runner/ }).check()
    await repository.getByRole('button', { name: 'Save', exact: true }).click()
    await saved(page)
    await expect(notSaved).toHaveCount(0)
  })
})

test('Product settings stack the sections in one column to the right of the Settings nav', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await ownProduct(page, async () => {
    const ids = ['readiness', 'releases', 'repository', 'intake', 'gates', 'proof']
    const boxes = await Promise.all(ids.map(async (id) => (await page.locator(`#${id}`).boundingBox())!))
    for (const [i, b] of boxes.entries()) {
      expect(b.x).toBe(boxes[0].x)
      expect(b.width).toBe(boxes[0].width)
      if (i) expect(b.y).toBeGreaterThan(boxes[i - 1].y + boxes[i - 1].height - 1)
    }
    const nav = (await page.getByRole('navigation', { name: 'Settings' }).boundingBox())!
    expect(nav.x + nav.width).toBeLessThanOrEqual(boxes[0].x)
  })
})

test('at 390 px Product, Workspace and Connect settings do not scroll sideways', async ({ page }) => {
  test.setTimeout(120_000)
  await ownProduct(page, async (path) => {
    await page.setViewportSize({ width: 390, height: 844 })
    for (const url of [path, '/settings/workspace', `${path}/connect`]) {
      await page.goto(url)
      const nav = (await page.getByRole('navigation', { name: 'Settings' }).boundingBox())!
      const content = (await page.locator('h1', { hasText: /^Settings$/ }).locator('xpath=..').boundingBox())!
      expect(nav.y + nav.height, url).toBeLessThanOrEqual(content.y + 1)
      const { sw, cw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }))
      expect(sw, url).toBeLessThanOrEqual(cw)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
  })
})

test('the mirror state shows a sync error in plain words', async ({ page }) => {
  await signIn(page)
  await inConnect(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Broken App' }).click()
  await expect(page.locator('#repository')).toContainText('The last sync failed: GitHub answered 401: Bad credentials')
})

test('a Product with a repository cannot be deleted', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings/products')
  await page.getByRole('link', { name: 'Acme Web' }).click()
  await expect(page.locator('#danger')).toContainText('Cannot delete yet')
  await expect(page.locator('#danger')).toContainText(/repositories/)
  await expect(page.locator('#danger').getByRole('button', { name: 'Delete Product' })).toHaveCount(0)
})

test(
  'add a Product: pick the repository from the forge, a taken short name is refused',
  { tag: '@fake-forge' },
  async ({ page }) => {
    const name = `E2E Picker ${Date.now()}`
    await signIn(page)
    await page.goto('/settings/products/new')
    await page.getByLabel('Product name').fill(name)
    const repo = page.getByLabel('Repository', { exact: true })
    await expect(repo.getByRole('option', { name: 'acme/picker' })).toHaveCount(1)
    await expect(repo.getByRole('option', { name: 'Other...' })).toHaveCount(1)
    await repo.selectOption('acme/picker')
    await page.locator('#new summary', { hasText: 'Advanced' }).click()
    await expect(page.getByLabel('Short name')).toHaveValue(/^e2e-picker-\d+$/)
    await page.getByRole('button', { name: 'Add Product' }).click()
    await expect(page).toHaveURL(/\/settings\/products\/\d+\/connect$/)
    const path = new URL(page.url()).pathname.replace(/\/connect$/, '')
    await page.goto(path)
    await expect(page.locator('#repository')).toContainText('acme/picker')

    await page.goto('/settings/products/new')
    await page.getByLabel('Product name').fill(name)
    await expect(page.getByLabel('Repository', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add Product' }).click()
    await expect(page.getByText('Another Product already uses this short name.')).toBeVisible()

    await deleteProduct(page, path)
  },
)

test('Members: an unknown GitHub login is refused, a known one is saved', { tag: '@fake-forge' }, async ({ page }) => {
  const member = () => page.getByRole('row', { name: new RegExp('^members-edit@example\\.com') })
  await signIn(page)
  await page.goto('/settings/bauherren')
  await member().getByText('Edit', { exact: true }).click()
  await member().getByLabel('GitHub login').fill('nobody-here')
  await member().getByRole('button', { name: 'Save' }).click()
  await expect(member().getByText('GitHub does not know @nobody-here. Check the spelling.')).toBeVisible()
  await member().getByLabel('GitHub login').fill('@fake')
  await member().getByRole('button', { name: 'Save' }).click()
  await expect(member().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await page.reload()
  await member().getByText('Edit', { exact: true }).click()
  await expect(member().getByLabel('GitHub login')).toHaveValue('fake')

  await member().getByLabel('GitHub login').fill('')
  await member().getByRole('button', { name: 'Save' }).click()
  await expect(member().getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
})
