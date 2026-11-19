# Feature map

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `docs/feature-map.yaml` (2452 lines) lists 118 features in 12 areas (Workflow 19, Quality and security 14, Agent team and sessions 12, Tickets 11, Models and cost 11, and seven smaller ones). It also holds `intro`, `legend` and per-area `notes`, including "Known gaps".
- Per feature: `id`, `area`, `title`, `summary`, `status` (`live` 104, `no-ui` 13, `hard-to-find` 1, `in-progress` 0), `page`, `pages`, `reach`, `mcp`, `source[]`, `tests[]`, `drive`, `proof` (`screenshot`, `tests`, `recording`, `none`), `gotchas`, `guards`, `debt`.
- `pnpm --filter server feature-map` renders the YAML into a features page: one table per area (Feature, What it does, Where, Status). Output goes to `docs/features.md` and `docs/site/docs/features.md`. Only the second file is in the tree at the tag.
- `pnpm verify <feature-id | area | --changed [base]>` picked features by id, area or changed files, sorted their tests into vitest, package, node and e2e sets and ran them.
- `areaOf` mapped changed paths to an area, used to group release items.
- `guards` and `debt` were empty in all 118 entries (`guards: []` 118 times). The AX skills said to fill them; nothing did.
- Credits: `docs/references.md` has a table of 15 sources by id. A skill or rule cites an id in its `sources` frontmatter. The feature `credits-page` covers it.
- The Knowledge repo could hold a per-Product `feature-map.yaml`, written by `verify-create` and read for release items.

## The requirement behind it

- One list of what the product can do and how to reach it, so docs, the Features page and tests do not drift (#698).
- Every feature should name its source, tests and a way to drive it live, so an agent can check a change.
- Every correction should become a guard recorded on its feature (trust pyramid, #703).
- Credit the people and articles the factory learned from.

## Where the code is

- `docs/feature-map.yaml` (2452 lines), `docs/references.md` (21), `docs/site/docs/features.md` (generated).
- `apps/server/scripts/feature-map.ts` (39): `loadMap`, `render`, `escapeTags`.
- `apps/server/src/lib/feature-map.ts` (41): `Feature` type, `parseMap`, `areaOf`, `STATUSES`, `PROOFS`.
- `apps/server/scripts/verify.ts` (90), `apps/server/scripts/verify-resolve.ts` (58): `resolveFeatures`, `classify`.
- `apps/server/src/lib/release-items.ts`: reads the map to group release items. `apps/server/src/lib/knowledge.ts` syncs `products/<slug>/feature-map.yaml`.
- Test `apps/server/tests/feature-map.test.ts` (88) checks: statuses and unique ids; a valid proof kind; source and test paths exist; tests present unless `in-progress`; every `(shell)` page route is covered by some `page` or `pages`; every MCP tool is listed in some `mcp`; every feature is rendered; every `sources` id in `pack/skills` and `pack/rules` exists in `docs/references.md`; no bare `<tag` in the page. Also `apps/server/tests/verify-resolve.test.ts`.
- Pack: `pack/skills/harden`, `pack/skills/verify-create`, `pack/skills/verify-maintain`, `pack/roles/ax.md`.

## Why it was cut

Most of the 118 features are deleted with the legacy engine, and every `guards` list in the map is empty. The lean core records corrections in its Learn module and keeps `docs/references.md` as the single map from source to check.

## What a module on the new core needs

- Contracts: Learn writes a guard (check, rule line or owner statement); the module only lists them per feature. It writes nothing on the ticket record.
- Lift almost unchanged: `parseMap`, `areaOf`, `escapeTags`, `render`, `resolveFeatures`, `classify`, and the path-exists and unique-id checks in `feature-map.test.ts`. `docs/references.md` is now a table of source, practice and enforcing file; `repo-files.test.ts` checks its paths, and the `sources` frontmatter check is gone.
- Redesign: the feature list itself (start from the surviving features, not the 118); `guards` as a link to a Learn entry rather than free text; the route and MCP-tool coverage checks against the nine new tools.
- Traps: hand-written `source` paths rot, so the map needs the path-exists test (the old one fails on any rename). Coverage of every page and tool forces a feature entry per page, which is why the map grew to 118. `drive` is `null` for 12 features, so `pnpm verify` cannot run them live. Generated page output in two places can disagree (inferred; `docs/features.md` is not in the tree).
