import { expect, type Locator } from '@playwright/test'

/** Clicks a ConfirmButton: the first click arms it (its label turns into the confirm text), the second submits. A click before hydration does nothing and a re-render can drop the armed state or detach the button mid-click, so arming and confirming repeat as a pair until `done` holds (the effect of the confirm: the row is gone, the URL changed). `noWaitAfter` makes the click return once it is dispatched. */
export const confirmClick = async (arm: Locator, confirm: Locator, done: () => Promise<void>) => {
  await expect(async () => {
    if (!(await confirm.isVisible())) await arm.click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000, noWaitAfter: true })
    await done()
  }).toPass({ timeout: 30_000 })
}
