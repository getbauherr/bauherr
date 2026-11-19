# Review rules

## What Important means here
- A wrong result, lost data, a security hole or a violated rule in `pack/rules/` on a path a real Run takes.
- A behaviour change without a test that fails without it.

## Cap the nits
At most 5 Nits per review; the rest is dropped.

## Do not report
- Anything CI enforces: typecheck, lint, the no-comments guard test.
- Generated files: `apps/server/src/migrations/index.ts`, lockfiles.

## Always check
- A behaviour claim cites `file:line`.
