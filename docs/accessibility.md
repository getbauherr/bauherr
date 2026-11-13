# Accessibility

Every page of the app meets WCAG 2.2 AA. CI enforces what a machine can check; the rest is a human read (UX specialist, Reviewer).

## What is checked
- `apps/server/e2e/a11y.spec.ts` runs axe-core (`@axe-core/playwright`) on every page, in light and dark theme, with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`. The signed-out `/login` is scanned too. Zero violations are allowed; a failure prints rule, target and fix hint.
- Axe results that need review (`incomplete`) for `color-contrast` fail the test too, unless the target is listed with a reason in `CONTRAST_REVIEWED`. Each scan must land on the URL it names, except routes listed in `redirects`.
- Keyboard, on `/settings/profile` only: sign-in with Tab and Enter only, the skip link reaches `main#main`, and one full Tab lap (until focus returns to the first stop, at most 200 stops) where every visible stop shows an outline or box-shadow. Other pages are not walked.
- `pnpm --filter server a11y:coverage` (CI job `check`) fails when a `page.tsx` route is missing from `routes` in the spec. A page that cannot be scanned goes into `apps/server/scripts/a11y-exceptions.ts` with the reason.

## Run it
Same recipe as every e2e spec (see [CONTRIBUTING.md](../CONTRIBUTING.md)):
`npx playwright test e2e/a11y.spec.ts` from `apps/server`, in Playwright's Docker image against a seeded server.

## Not covered
Screen readers, voice control, zoom and reflow at 400 %, and anything axe cannot decide (meaningful alt text, reading order, plain language). A UI change still gets a manual keyboard pass.

## Adding a page
Add its route to `routes` in the spec (a function finds the URL of a detail page). Fix violations in the component; never disable a rule.
