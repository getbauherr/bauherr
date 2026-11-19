---
globs: ["**/*.ts", "**/*.tsx", "**/*.mts"]
applies: every Run that writes code
---

# No code comments

Source code under `apps/` and `packages/` has no comments, trailing ones included. Allowed: tool directives (`@ts-expect-error`, `@ts-nocheck`, `/// <reference`, `#!`, `eslint-disable*` with ` -- reason`, `c8`/`istanbul ignore`, `webpackChunkName`, `@vite-ignore`), license headers, JSDoc on exported declarations in `packages/cli/src` and `packages/adapters/src`, and a link to an external dependency's issue that explains a forced workaround.
Encode the reason as a name, type, test or check instead. Enforced by `apps/server/tests/no-comments.test.ts`.
