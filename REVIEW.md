# Review rules

## What Important means here
- A wrong result, lost data, a security hole or a violated rule in `pack/rules/` on a path a real Run takes.
- A behaviour change without a test that fails without it.
- A Ticket correction (a replan, a changed Goal statement) that has no check.

## Cap the nits
At most 5 Nits per review; the rest is dropped.

## Do not report
- Anything CI enforces: typecheck, lint, the no-comments and feature-map guard tests.
- Generated files: `docs/features.md`, `apps/server/src/migrations/index.ts`, lockfiles.

## Always check
- The feature map entry is updated when a feature changes.
- A Ticket correction has a check.
- A behaviour claim cites `file:line`.
