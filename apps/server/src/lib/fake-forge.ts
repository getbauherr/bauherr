import { FakeBackend } from '@bauherr/adapters'

/** E2E only (`BAUHERR_E2E_FAKE_FORGE=1`): in-memory forge holding the seeded Ticket #1 of `acme/web` with a plan and a worklog. */
const PLAN = `<!-- bauherr:plan -->
# Plan: dark theme for the dashboard

## Steps
1. Add colour tokens for the dark palette
2. Wire the theme toggle into the top bar

## Decisions

- **D1 Where to store the choice**. Default: localStorage. Alternative: a cookie.
- **D2 Follow the system setting, critical**. Default: yes, until the user picks. Alternative: never, always light first.
`

const WORKLOG = `<!-- bauherr:worklog -->
## Worklog
**Goal**
- [ ] A dark theme exists

**Decisions**
- 2026-10-30 Use CSS custom properties. Consequence: no runtime theme library. By: plan Run.
`

const summary = (n: number) => `<!-- bauherr:staging-summary -->

# Staging summary: #${n} Ship the export

## What you get

CSV export for invoices.

## Accept

Check it on staging, then accept.
`

const build = (): FakeBackend => {
  const fake = new FakeBackend({ native: true, users: ['fake', 'e2e-admin'] })
  const ts = fake.tickets('acme/web')
  // FakeBackend methods are async but never await, so these complete synchronously.
  void ts.create({ title: 'Add a dark theme to the dashboard', labels: ['bauherr:stage:plan'] })
  void ts.comment('1', PLAN)
  void ts.comment('1', WORKLOG)
  // #2-#5 are placeholders so that later seeded Tickets line up with their forge numbers.
  for (const n of [2, 3, 4, 5]) void ts.create({ title: `Placeholder ${n}` })
  for (const [n, title] of [[6, 'Ship the CSV export'], [7, 'Ship the invoice filter']] as const) {
    void ts.create({ title, labels: ['bauherr:stage:release'] })
    void ts.comment(String(n), WORKLOG)
    void ts.comment(String(n), summary(n))
  }
  return fake
}

const g = globalThis as { __bauherrFakeForge?: FakeBackend }
export const fakeForge = (): FakeBackend => (g.__bauherrFakeForge ??= build())
