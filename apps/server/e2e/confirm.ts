import { expect, type Locator } from '@playwright/test'

export const confirmClick = async (arm: Locator, confirm: Locator, done: (timeout: number) => Promise<void>) => {
  const holds = (timeout: number) => done(timeout).then(() => true, () => false)
  await expect(async () => {
    if (await holds(500)) return
    if (!(await confirm.isVisible())) await arm.click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000, noWaitAfter: true })
    await done(8_000)
  }).toPass({ timeout: 40_000 })
}
