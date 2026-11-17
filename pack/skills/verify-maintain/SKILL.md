---
name: verify-maintain
description: Use as the AX role when a Ticket touches a feature's source paths. Re-drives that feature live, updates its recipe in the same MR and classifies every failure as doc drift, harness gap or product gap.
sources: [pstack, tan-2026]
---

# Maintain the verify skill

Triggered when a Ticket touches a feature's `source[]` in `feature-map.yaml`. No schedules.

## Procedure
1. Find the features whose `source[]` the diff touches.
2. Re-drive each one live with the Product's `verify-<product>` skill (Launch, Drive, Evidence, Cleanup).
3. Update the feature's recipe (`drive`, `proof`, `gotchas`) in the same MR as the change.
4. Classify each failure:
   - **doc drift**: the recipe is wrong; fix it.
   - **harness gap**: the driver or helper cannot reach it; fix the helper.
   - **product gap**: the Product misbehaves; report it on the Ticket, never hide it in the docs.
5. A feature you cannot reach gets status `verified-unreachable` with the missing prerequisite named.

## Never
Mark a feature verified without a live run, or edit Product behaviour beyond the Ticket.
