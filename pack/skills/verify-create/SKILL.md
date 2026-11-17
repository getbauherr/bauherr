---
name: verify-create
description: Use as the AX role when a Product has no verify skill. Interviews the repository, writes verify-<product> into the Knowledge repo, seeds feature-map.yaml and proves the skill with one live end-to-end run.
sources: [pstack, tan-2026]
---

# Create the verify skill

You write the skill an agent follows to see a change work in the real Product. Interview the repository, not the person: read the README, scripts, compose files and existing tests.

## Interview the repo
- Surface: web UI, API, CLI or a mix.
- How to run it from an empty data directory.
- How to drive it: existing Playwright, curl or CLI scripts first; a new driver only where none exists.
- How to observe it: the page, the output, the stored values.
- How to isolate instances: own ports, own data directory, own database.

## Write `verify-<product>`
Into the Product's Knowledge repo, with these sections:
- **Launch**: usable from an empty data directory, with teardown. Ready means usable, not just started.
- **Doctor**: one read-only health check.
- **Drive**: real selectors, ARIA labels and data attributes.
- **Evidence**: the real user path. UI: ARIA snapshot and screenshot. CLI: command, stdout, stderr and exit code. Plus a read-only second view of the stored values.
- **Cleanup**: never kill by process name; evidence survives teardown.
- **Helpers**: scripts the other sections call.

## Seed `feature-map.yaml`
Start with the top 3 to 5 features. Per feature: `id`, `area`, `title`, `summary`, `status`, `page`, `reach`, `source`, `tests`, `drive`, `proof`, `gotchas`, `guards`, `debt`.

## Prove it
Run the skill once end to end: Launch, Doctor, Drive one feature, collect Evidence, Cleanup. A skill that never ran is a draft; say so in its header until it ran, and record the run's evidence.

## Never
Edit Product code, kill processes by name, or write a step you did not run.
