import { expect, type Locator } from '@playwright/test'

/**
 * Clicks a ConfirmButton: the first click arms it (its label turns into the confirm text), the second submits. A click before hydration does nothing and a re-render can drop the armed state or detach the button mid-click, so arming and confirming repeat as a pair until `done(timeout)` holds (the effect of the confirm: the row is gone, the URL changed). An attempt first checks whether the effect is already there (a slow submit), so a finished removal is never armed again. `noWaitAfter` makes the click return once it is dispatched.
 */
export const confirmClick = async (arm: Locator, confirm: Locator, done: (timeout: number) => Promise<void>) => {
  const holds = (timeout: number) => done(timeout).then(() => true, () => false)
  await expect(async () => {
    if (await holds(500)) return
    if (!(await confirm.isVisible())) await arm.click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000, noWaitAfter: true })
    await done(8_000)
  }).toPass({ timeout: 40_000 })
}
