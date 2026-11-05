import { expect, type Locator } from '@playwright/test'

/** Clicks a ConfirmButton: the first click arms it (its label turns into the confirm text), the second submits. A click before hydration does nothing and a re-render can drop the armed state again, so arming and confirming repeat as a pair until the confirm click lands; `noWaitAfter` makes the click return once it is dispatched, so it is never retried after it went through. */
export const confirmClick = async (arm: Locator, confirm: Locator) => {
  await expect(async () => {
    if (!(await confirm.isVisible())) await arm.click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000, noWaitAfter: true })
  }).toPass({ timeout: 20_000 })
}
