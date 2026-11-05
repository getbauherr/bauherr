import { expect, type Locator } from '@playwright/test'

/** Clicks a ConfirmButton: the first click arms it (its label turns into the confirm text), the second submits. A click before hydration does nothing, so the arming click repeats until the confirm shows. */
export const confirmClick = async (arm: Locator, confirm: Locator) => {
  await expect(async () => {
    if (!(await confirm.isVisible())) await arm.click({ timeout: 2_000 })
    await confirm.click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}
